# Image uploads: HEIC conversion and previews

How images get from a phone to S3, and how apps and the website should display them.

## In short

- **Every image is stored as two files**, side by side in S3:
  - the **main image**: the full-size photo;
  - a **preview**: a small WebP, at most 1080 px on its longest side, about 80–150 KB.
- **iPhone HEIC/HEIF photos are converted to JPEG before upload.** Only Safari can display HEIC; Chrome, Firefox and Edge show it as a broken image.
- **The database stores only the main image's URL**, the same single string as before. No schema or API response changed.
- **The preview's address is always worked out from the main image's address**, so any code that has an image URL can find its preview.
- **Lists, cards and thumbnails show the preview. Full-screen and detail views show the main image.** If a preview doesn't exist, clients fall back to the main image.

All image processing happens on the phone. The server only signs upload links; it never receives image bytes.

## Where the preview lives

Add `previews/` before the file name and change the extension to `.webp`:

```
main:    Decorator/images/1730100000000-IMG_2041.jpg
preview: Decorator/images/previews/1730100000000-IMG_2041.webp
```

This only applies to files under an `images/` folder that aren't already inside `previews/`. Videos, documents and audio have no preview.

The rule is written once on each side. Keep the two in step:

| Side | Function |
|---|---|
| Upload service | `previewKeyFor(key)` in `upload-service/src/services/uploadService.js` |
| Vendor app | `previewUrlFor(url)` in `lib/core/utils/media_url.dart` |

## What happens during an upload

```
Phone                                   upload-service                 S3
-----                                   --------------                 --
1. Vendor picks a photo
2. HEIC/HEIF?  -> convert to JPEG (q90), name becomes .jpg
3. Make WebP preview (<=1080px, q75)
4. POST /api/uploads/presign  ------->  signs two PUT links
   { fileName, vendorType, size,        (main + preview, same key stem)
     withPreview: true }       <-------  { uploadUrl, key, publicUrl,
                                           contentType, preview: {...} }
5. PUT preview  ------------------------------------------------------>  previews/<name>.webp
6. PUT main image  --------------------------------------------------->  <name>.jpg
7. Save publicUrl (main image) on the package/profile/etc., as before
```

The preview is uploaded **first**, so it already exists by the time anyone sees the saved URL.

**Failures:**
- If the preview upload fails after retries, the main image still uploads and is saved. Clients fall back to it.
- If a HEIC photo can't be converted, the app stops and asks the vendor to pick another photo. It never uploads a raw HEIC.

## API changes (upload-service)

All changes add fields; nothing existing changed. App builds that don't send `withPreview` get exactly the same responses as before.

### `POST /api/uploads/presign` and `POST /api/uploads/multipart/create`

New optional request field:

```json
{ "fileName": "IMG_2041.jpg", "vendorType": "Decorator", "size": 2481934, "withPreview": true }
```

When `withPreview` is true **and** the file is an image, the response also carries a `preview` object:

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...signed PUT for the main image...",
    "key": "Decorator/images/1730100000000-IMG_2041.jpg",
    "publicUrl": "https://<cloudfront>/Decorator/images/1730100000000-IMG_2041.jpg",
    "contentType": "image/jpeg",
    "preview": {
      "uploadUrl": "https://...signed PUT for the preview...",
      "key": "Decorator/images/previews/1730100000000-IMG_2041.webp",
      "publicUrl": "https://<cloudfront>/Decorator/images/previews/1730100000000-IMG_2041.webp",
      "contentType": "image/webp"
    }
  }
}
```

- **Sending the files:** PUT each file to its own `uploadUrl` with the matching `Content-Type`. Don't send an `x-amz-acl` header; the ACL is already part of the signed link.
- **Large files:** for multipart uploads, the main image still goes up in parts, but the preview is always one small PUT.
- **Non-images:** documents and videos ignore `withPreview` and get no `preview` object.

### `DELETE /api/uploads`

Deleting an image also deletes its preview. Aborting a multipart image upload also deletes a preview that was already uploaded.

## Showing images in a client

1. **Lists, cards, grids, thumbnails, avatars:** request the preview URL. If it fails to load (404), load the main URL instead.
2. **Full-screen viewers, hero banners, zoomable views:** use the main URL.
3. **Only rewrite URLs for our own uploads**, meaning our CloudFront domains or the S3 bucket, with an `images/` folder in the path. Use any other URL as it is: Google/Facebook profile photos, seed or demo images, app artwork.

The vendor app does this in `AppCachedImage(preferPreview: true)` (`lib/shared/widgets/app_cached_image.dart`). It also remembers previews that turned out to be missing, so a list doesn't request them again on every rebuild.

### For the customer app, the website and admin

You don't have to change anything; the main URLs work as before. To make lists faster, copy the rule above, for example in JavaScript:

```js
function previewUrlFor(url) {
  try {
    const u = new URL(url);
    const ours = u.hostname.endsWith(".cloudfront.net") ||
      (u.hostname.includes(".s3.") && u.hostname.endsWith(".amazonaws.com"));
    const parts = u.pathname.split("/");
    const folders = parts.slice(0, -1);
    if (!ours || !folders.includes("images") || folders.includes("previews")) return url;
    const name = parts.at(-1).replace(/\.[^.]+$/, "");
    u.pathname = [...folders, "previews", `${name}.webp`].join("/");
    return u.toString();
  } catch {
    return url;
  }
}
// <img src={previewUrlFor(url)} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = url; }} />
```

**If those clients also accept uploads** (review photos, note attachments, enquiry images), they must convert HEIC to JPEG before uploading too:
- **Website:** use `heic2any` in the browser.
- **Customer Flutter app:** reuse `NativeImageUploadPreparer` from the vendor app.

Until they do, re-running the cleanup script (below) fixes whatever HEIC files they upload.

## Images uploaded before this change: cleanup script

`upload-service/scripts/fix-heic-and-previews.mjs` works on the bucket directly. It has two jobs:

**1. Convert stored HEIC/HEIF files to JPEG in place.**
- The file stays at the same key, now with `Content-Type: image/jpeg`. Browsers go by the content type, not the `.heic` extension, so the URLs already saved in Mongo start working with no database change.
- Before overwriting, the original is copied to `_heic-backup/<same key>`.
- Converted paths are invalidated in CloudFront so the old cached HEIC stops being served.

**2. Create missing previews** for every image under an `images/` folder. It skips old v1 files named `preview-<timestamp>.*`.

**Run it** from `upload-service/`, with the env file for the bucket you want to fix. The script prints the bucket name on its first line.

> Both `upload-service/.env` and `.env.prod` currently point at `eventory-bucket-prod`. Check `AWS_S3_BUCKET_NAME` before running with `--apply`.

```
node --env-file=.env scripts/fix-heic-and-previews.mjs           # dry run: reports only
node --env-file=.env scripts/fix-heic-and-previews.mjs --apply   # writes
```

**Options:**

| Flag | Effect |
|---|---|
| `--prefix=Decorator/` | only keys under this prefix |
| `--only=heic` / `--only=previews` | run one job |
| `--concurrency=8` | parallel objects (default 4) |

It is safe to run again:
- HEIC keys already holding JPEG content are skipped.
- Images that already have a preview are skipped.

**Setup:**
- `CLOUDFRONT_DISTRIBUTION_ID`: add it to the env file you run with. Without it, the script prints the paths to invalidate by hand.
- **IAM permissions:** the key needs `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, `s3:PutObjectAcl` and `cloudfront:CreateInvalidation`.
- **Dependencies:** `sharp`, `heic-convert` and `@aws-sdk/client-cloudfront` are dev dependencies. Run `npm install` locally first. The server deploy uses `npm ci --omit=dev`, so they never reach production.

**When to run it:**
1. With `--prefix` on one small folder first. Check a few converted images in Chrome.
2. On the whole bucket, after the upload-service change is deployed. Delete `_heic-backup/` once you're happy.
3. Again 2–4 weeks after the new app version is released. Older app versions keep uploading HEIC (and images without previews) until vendors update.

**Last dry run, on `eventory-bucket-prod` (2026-10-28):** 20,047 objects scanned, 22 HEIC files to convert, about 1,830 images needing previews.

## Package cover image

Several endpoints pick a package's cover image for snapshots, cart lines, compare rows, enquiries and templates. They all use `packageCoverImage(pkg)` in `src/utils/packageCoverImage.js`:
- It takes the **first image** in `step4_sampleMedia.media` and skips videos, which can't be drawn as a cover.
- For venue packages, which keep media per space, it looks in `step4_sampleMedia.spaceMedia[].media`.

Before this change, these endpoints took `media[0]` even when it was a video, and returned no cover for venues.

## Files involved

**Backend**
- `upload-service/src/services/uploadService.js`:
  - `previewKeyFor`, `hasPreview` and `isPreviewKey`
  - preview links in `createPresignedPut` and `createMultipart`
  - preview removal in `deleteObject` and `abortMultipart`
- `upload-service/src/validators/uploadValidators.js`: `withPreview`
- `upload-service/scripts/fix-heic-and-previews.mjs`: cleanup script
- `src/utils/packageCoverImage.js`, used by the booking, cart, checkout, compare, enquiry and template controllers

**Vendor app** (`eventory_business_app_v2`)
- `lib/core/services/image_upload_preparer.dart`: HEIC→JPEG and preview creation (`flutter_image_compress`)
- `lib/core/services/s3_upload_service.dart`:
  - every image upload goes through the preparer
  - the preview is sent first
  - the main URL is returned as before
- `lib/core/utils/media_url.dart`: `previewUrlFor`
- `lib/shared/widgets/app_cached_image.dart`: `preferPreview`, with fallback to the main image
