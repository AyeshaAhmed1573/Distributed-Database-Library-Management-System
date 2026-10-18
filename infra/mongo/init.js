db = db.getSiblingDB("library_docs");

// ---------- reviews & ratings ----------
db.createCollection("reviews", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["isbn", "user_id", "rating", "created_at"],
      properties: {
        isbn:          { bsonType: "string" },
        user_id:       { bsonType: "string" },
        rating:        { bsonType: "int", minimum: 1, maximum: 5 },
        title:         { bsonType: "string" },
        comment:       { bsonType: "string" },
        helpful_votes: { bsonType: "int", minimum: 0 },
        created_at:    { bsonType: "date" },
      },
    },
  },
});
db.reviews.createIndex({ isbn: 1, created_at: -1 });
db.reviews.createIndex({ user_id: 1 });
db.reviews.createIndex({ isbn: 1, user_id: 1 }, { unique: true });
db.reviews.createIndex({ title: "text", comment: "text" });

// ---------- activity logs ----------
db.createCollection("activity_logs", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["action", "created_at"],
      properties: {
        user_id:    { bsonType: "string" },
        action:     { enum: ["login", "search", "view", "reserve", "cancel_hold"] },
        isbn:       { bsonType: "string" },
        branch:     { bsonType: "string" },
        query:      { bsonType: "string" },
        meta:       { bsonType: "object" },
        created_at: { bsonType: "date" },
      },
    },
  },
});
db.activity_logs.createIndex({ user_id: 1, created_at: -1 });
db.activity_logs.createIndex({ action: 1, created_at: -1 });
db.activity_logs.createIndex({ created_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });