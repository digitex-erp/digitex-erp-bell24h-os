const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("Connecting to the database...");
    await client.connect();

    console.log("Reading schema SQL file...");
    const sql = fs.readFileSync('supabase_schema.sql', 'utf8');

    console.log("Executing schema SQL...");
    await client.query(sql);
    
    console.log("Migration executed successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
