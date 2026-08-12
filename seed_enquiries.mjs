import mongoose from "mongoose";
import Enquiry from "./src/models/Enquiry.js";

const VENDOR_OID = new mongoose.Types.ObjectId("6a4637c98f6f2df657127147");

const ENQUIRIES = [
  {
    enquiryId: "EVT-ENQ-PAV005",
    vendorId: VENDOR_OID,
    customer: {
      name: "Rohan Desai",
      phone: "+91 9876543210",
      email: "rohan.d@example.com",
    },
    eventType: "Corporate Offsite",
    eventDate: new Date("2026-11-20"),
    startTime: "09:00",
    endTime: "18:00",
    budgetMin: 50000,
    budgetMax: 100000,
    expectedBudgetStr: "₹ 50K - ₹ 1L",
    guestCountMax: 200,
    requests: ["LED Wall", "Sound System", "Microphones"],
    matchStrength: "Strong",
    eventImageUrl: "https://picsum.photos/seed/1/1200/400",
    questionnaire: [
      { question: "What is the primary objective of this event?", answer: "Team building and annual awards ceremony." },
      { question: "Any specific theme preferred?", answer: "Looking for a futuristic/tech vibe, with blue and silver accents." }
    ],
    status: "NewEnquiry",
    venueName: "Taj Lands End, Mumbai",
    customerMessage: "We are looking for a complete AV setup including a large LED wall, professional sound system, and lighting for the evening party. Please ensure high-quality microphones for the presentations.",
    primaryPackage: {
      name: "Premium Corporate AV Package",
      price: 75000,
      image: "https://d1u34m45xfa3ar.cloudfront.net/PAV/images/corporate_av.jpg"
    },
    customiseData: {
      additionsTitle: "Additional Equipment Requested",
      additions: [
        {
          id: "add_1",
          label: "Extra Wireless Mics",
          value: "4 Units",
          status: "pending",
          image: ""
        }
      ],
      exclusionsTitle: "Items to Exclude",
      exclusions: [],
      equipments: [],
      addons: []
    },
    attachments: [
      {
        name: "Stage_Layout_Reference.jpg",
        url: "https://picsum.photos/seed/2/1200/400"
      }
    ],
    priority: "High",
    conflictDetected: false,
    detailedRequests: [
      {
        category: "Audio",
        title: "Sound System Requirements",
        fields: [
          { label: "Audience Size", value: "200 pax" },
          { label: "Venue Type", value: "Indoor Ballroom" }
        ],
        sections: []
      }
    ]
  },
  {
    enquiryId: "EVT-ENQ-MKP001",
    vendorId: VENDOR_OID,
    customer: {
      name: "Sneha Patel",
      phone: "+91 9123456789",
      email: "sneha.p@example.com",
    },
    eventType: "Wedding Reception",
    eventDate: new Date("2026-12-15"),
    startTime: "17:00",
    endTime: "20:00",
    budgetMin: 35000,
    budgetMax: 50000,
    expectedBudgetStr: "₹ 35,000 - ₹ 50,000",
    guestCountMax: 5,
    matchStrength: "Strong",
    requests: ["Bridal HD Makeup", "Silk Press & Style", "Facial"],
    eventImageUrl: "https://picsum.photos/seed/3/1200/400",
    questionnaire: [
      { question: "Any specific makeup style?", answer: "Dewy, natural glass-skin finish. Nothing too heavy." },
      { question: "Do you have any skin allergies?", answer: "Sensitive to fragrances." }
    ],
    status: "NewEnquiry",
    venueName: "ITC Maratha, Mumbai",
    customerMessage: "I want a very natural, glowing look for my reception. I'll be wearing an ivory lehenga. Can we do a trial next month?",
    primaryPackage: {
      name: "Bridal Airbrush Makeup",
      price: 25000,
      image: "https://picsum.photos/seed/4/1200/400"
    },
    customiseData: {
      additionsTitle: "Additional Services",
      additions: [
        {
          id: "add_3",
          label: "Hair Styling for Sister",
          value: "1 Person",
          status: "pending",
          image: ""
        }
      ],
      exclusionsTitle: "Items to Exclude",
      exclusions: [],
      equipments: [],
      addons: []
    },
    attachments: [
      {
        name: "Look_Inspo_1.jpg",
        url: "https://picsum.photos/seed/5/1200/400"
      }
    ],
    priority: "Medium",
    conflictDetected: false,
    detailedRequests: [
      {
        category: "💄 MAKEUP",
        title: "BRIDAL HD MAKEUP",
        fields: [{ label: "Brand", value: "MAC" }, { label: "Look", value: "Natural, Dewy" }, { label: "Airbrush", value: "Yes" }],
        sections: []
      },
      {
        category: "💆‍♀️ SKIN & SPA",
        title: "BRIDAL GLOW FACIAL",
        fields: [{ label: "Skin Type", value: "Sensitive" }, { label: "Duration", value: "60 mins" }],
        sections: []
      }
    ]
  },
  {
    enquiryId: "EVT-ENQ-DJ002",
    vendorId: VENDOR_OID,
    customer: { name: "Kabir Singh", phone: "+91 9988776655", email: "kabir@example.com" },
    eventType: "Sangeet",
    eventDate: new Date("2026-11-25"),
    startTime: "19:00",
    endTime: "02:00",
    budgetMin: 35000,
    budgetMax: 50000,
    expectedBudgetStr: "₹ 35K - ₹ 50K",
    guestCountMax: 300,
    matchStrength: "Good",
    requests: ["Bollywood Music", "Punjabi Tracks", "Smoke Machine"],
    eventImageUrl: "https://picsum.photos/seed/6/1200/400",
    questionnaire: [
      { question: "What vibe are you going for?", answer: "High energy, non-stop dancing." }
    ],
    status: "AwaitingResponse",
    venueName: "The Leela, Gurugram",
    primaryPackage: { name: "Pro DJ Setup", price: 35000, image: "https://loremflickr.com/200/200/dj" },
    customerMessage: "Need a DJ who can keep the crowd going till 2 AM.",
    detailedRequests: [
      {
        category: "🎵 MUSIC",
        title: "PLAYLIST PREFERENCES",
        fields: [{ label: "Genres", value: "Bollywood, Punjabi, Top 40" }, { label: "Special Requests", value: "Bride entry song" }],
        sections: []
      }
    ],
    attachments: [
      { name: "Sangeet_Vibe.jpg", url: "https://picsum.photos/seed/7/1200/400" }
    ]
  },
  {
    enquiryId: "EVT-ENQ-CAT003",
    vendorId: VENDOR_OID,
    customer: { name: "Pooja Hegde", phone: "+91 9555666777" },
    eventType: "Engagement",
    eventDate: new Date("2026-10-10"),
    startTime: "12:00",
    endTime: "16:00",
    budgetMin: 150000,
    budgetMax: 200000,
    expectedBudgetStr: "₹ 1.5L - ₹ 2L",
    guestCountMax: 150,
    matchStrength: "Strong",
    requests: ["Live Counters", "Mocktails", "Dessert Bar"],
    eventImageUrl: "https://picsum.photos/seed/8/1200/400",
    questionnaire: [
      { question: "Any dietary restrictions?", answer: "10 guests require Jain food." }
    ],
    status: "ProposalSent",
    venueName: "JW Marriott, Pune",
    primaryPackage: { name: "Silver Catering", price: 150000, image: "https://loremflickr.com/200/200/food" },
    customerMessage: "Looking for a premium lunch spread with live pasta and chaat counters.",
    detailedRequests: [
      {
        category: "🍽 CATERING",
        title: "MENU SPREAD",
        fields: [{ label: "Cuisine", value: "North Indian, Italian, Chinese" }, { label: "Live Counters", value: "Pasta, Chaat" }],
        sections: []
      }
    ],
    proposal: {
      customPrice: 145000,
      pricing: { original: 150000, discount: 5000, finalAmount: 145000 },
      vendorNotes: "I have added a 5k discount as discussed on call.",
      paymentMilestones: [
        { title: "Advance", percentage: 50, amount: 72500 }
      ]
    },
    attachments: [
      { name: "Menu_Options.pdf", url: "https://example.com/menu.pdf" },
      { name: "Food_Inspo.jpg", url: "https://picsum.photos/seed/9/1200/400" }
    ]
  },
  {
    enquiryId: "EVT-ENQ-DEC004",
    vendorId: VENDOR_OID,
    customer: { name: "Rahul Sharma", phone: "+91 9001122334" },
    eventType: "Corporate Party",
    eventDate: new Date("2026-10-16"),
    startTime: "16:00",
    endTime: "20:00",
    budgetMin: 250000,
    budgetMax: 400000,
    expectedBudgetStr: "₹2.5L - ₹4L",
    guestCountMax: 250,
    guestCountStr: "80 - 250",
    matchStrength: "Strong",
    requests: ["Live Station", "Chat counter", "Lighting", "Furniture"],
    eventImageUrl: "https://picsum.photos/seed/5/1200/400",
    questionnaire: [
      { question: "What feels overpriced in the package", answer: "The styling add-on feels too expensive for what's included" },
      { question: "Would prefer a lower-cost package with fewer inclusions", answer: "Yes" },
      { question: "Comparing with another quote?", answer: "Yes, has a quote from another vendor" },
      { question: "Message from customer", answer: '"Say hello and ask a question about styling — looking for something elegant but not too over the top for a corporate crowd."' }
    ],
    status: "Converted",
    venueName: "Grand Hyatt Ballroom",
    primaryPackage: { name: "Corporate Premium Package", price: 25000, image: "https://loremflickr.com/200/200/flowers" },
    detailedRequests: [
      {
        category: "Decorator",
        title: "ROYAL PASTEL MEADOW",
        sections: [
          {
            dividerText: "Setup Detail",
            title: "FLORAL ARCH",
            fields: [
              { label: "Decorating Elements", value: "Hall" },
              { label: "Included Structures", value: "Stage Riser" },
              { label: "Type of Setup", value: "Indoor" },
              { label: "Theme", value: "Boho" }
            ]
          },
          {
            dividerText: "Items Detail",
            subtitleLabel: "Setup Name",
            subtitle: "NAME OF ITEM",
            fields: [
              { label: "Item Type", value: "Lighting" },
              { label: "Lighting Type", value: "Fairy Lights" },
              { label: "Dimensions", value: "193cm" },
              { label: "Colors", value: "Blue, Red +2more" },
              { label: "Quantity", value: "2x" }
            ]
          },
          {
            subtitleLabel: "Setup Name",
            subtitle: "NAME OF ITEM2",
            fields: [
              { label: "Item Type", value: "Furniture" },
              { label: "Furniture Type", value: "Long Tables" },
              { label: "Quantity", value: "3x" },
              { label: "Colors", value: "Red & Green" }
            ]
          },
          {
            subtitleLabel: "Setup Name",
            subtitle: "NAME OF ITEM2",
            fields: [
              { label: "Item Type", value: "Flower" },
              { label: "Flower Type", value: "Marigold" },
              { label: "Volume", value: "Medium" },
              { label: "Colors", value: "Red & Green" }
            ]
          }
        ]
      }
    ],
    customiseData: {
      groupedAdditions: [
        {
          dividerText: "Setup Elements to Add",
          title: "FLORAL ARCH ( setup name )",
          items: [
            { id: "add1", label: "Decorating Elements", value: "Hall", status: "accepted" },
            { id: "add2", label: "Theme", value: "Boho, Fusion", status: "accepted" }
          ]
        },
        {
          dividerText: "Items to Add",
          title: "FLORAL ARCH ( setup name )",
          subtitle: "Item 1 Name",
          items: [
            { id: "add3", label: "Lighting Type", value: "Fairy Lights", status: "pending" },
            { id: "add4", label: "Dimensions", value: "210 CM", status: "rejected" }
          ]
        },
        {
          title: "FLORAL ARCH ( setup name )",
          subtitle: "Item 2 Name",
          items: [
            { id: "add5", label: "Flower Type", value: "Marigold", status: "rejected", hasColorPicker: true }
          ]
        }
      ],
      groupedExclusions: [
        {
          dividerText: "Setup Elements to Remove",
          title: "VINTAGE CANDLES ( setup name )",
          items: [
            { id: "exc1", label: "Decorating Elements", value: "Hall", status: "rejected", suggestedSubstitute: "Door" },
            { id: "exc2", label: "Decorating Elements", value: "Door", status: "pending" }
          ]
        },
        {
          dividerText: "Items to Remove",
          title: "FLORAL ARCH ( setup name )",
          items: [
            { id: "exc3", label: "Item", value: "Furniture ( Item Name )", status: "accepted" }
          ]
        }
      ],
      addons: [
        {
          id: "addon1",
          name: "Add-on Name",
          desc: "Category",
          price: 2000,
          image: "https://picsum.photos/seed/addon/200/200",
          fields: [
            { label: "Colour", value: "Red & Green" },
            { label: "Dimensions", value: "100 x 80 x 15 CM" }
          ]
        }
      ]
    },
    proposal: {
      pricing: {
        original: 300000,
        itemsAdded: 30000,
        addonsAdded: 15000,
        substituteItemsAdded: 10000,
        itemsRemoved: 30000,
        addonsRemoved: 7000,
        discount: 5000,
        gst: 55800,
        finalAmount: 365800
      }
    },
    attachments: [
      { name: "Stage_Ref.jpg", url: "https://picsum.photos/seed/1/800/800" },
      { name: "Venue_Layout.png", url: "https://picsum.photos/seed/2/800/800" }
    ]
  },
  {
    enquiryId: "EVT-ENQ-VEN005",
    vendorId: VENDOR_OID,
    customer: { name: "Deepika P.", phone: "+91 9444556677" },
    eventType: "Pre-Wedding",
    eventDate: new Date("2026-12-01"),
    startTime: "08:00",
    endTime: "20:00",
    budgetMin: 800000,
    budgetMax: 1000000,
    expectedBudgetStr: "₹ 8L - ₹ 10L",
    guestCountMax: 500,
    matchStrength: "Weak",
    requests: ["Pool Access", "Bridal Room", "Mandap Space"],
    eventImageUrl: "https://picsum.photos/seed/12/1200/400",
    questionnaire: [
      { question: "Number of rooms required?", answer: "20 rooms for close family." }
    ],
    status: "Declined",
    venueName: "Udaipur Palace",
    primaryPackage: { name: "Udaipur Palace Rental", price: 800000, image: "https://loremflickr.com/200/200/palace" },
    notes: "Declined due to date unavailability",
    detailedRequests: [
      {
        category: "🏰 VENUE",
        title: "SPACE REQUIREMENTS",
        fields: [{ label: "Spaces", value: "Lawn, Banquet, Poolside" }, { label: "Rooms", value: "20 Deluxe Rooms" }],
        sections: []
      }
    ],
    attachments: [
      { name: "Venue_Map.pdf", url: "https://example.com/venue_map.pdf" }
    ]
  }
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const result = await Enquiry.deleteMany({
    enquiryId: { $in: ["EVT-ENQ-PAV005", "EVT-ENQ-MKP001", "EVT-ENQ-DJ002", "EVT-ENQ-CAT003", "EVT-ENQ-DEC004", "EVT-ENQ-VEN005"] },
  });
  if (result.deletedCount > 0) {
    console.log(`🗑  Removed ${result.deletedCount} previous seed enquiries`);
  }

  const inserted = await Enquiry.insertMany(ENQUIRIES);
  console.log(`✅ Inserted ${inserted.length} seed enquiries:\n`);
  inserted.forEach((e) =>
    console.log(`   ${e.enquiryId}  ${e.status.padEnd(10)}  ${e.customer.name}`)
  );

  await mongoose.disconnect();
  console.log("\n✅ Done");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
