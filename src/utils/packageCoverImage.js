const VIDEO_EXTENSION = /\.(mp4|mov|avi|mkv|webm|wmv)$/i;

const isImage = (m) =>
  Boolean(m?.url) && m.type !== "video" && !VIDEO_EXTENSION.test(m.url);

const firstImage = (media) => (media || []).find(isImage)?.url;

export const packageCoverImage = (pkg) => {
  const step4 = pkg?.step4_sampleMedia || {};
  const fromMedia = firstImage(step4.media);
  if (fromMedia) return fromMedia;
  for (const space of step4.spaceMedia || []) {
    const url = firstImage(space?.media);
    if (url) return url;
  }
  return null;
};
