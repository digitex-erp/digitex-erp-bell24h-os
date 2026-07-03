const fs = require('fs');
const metadata = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
metadata.name = "Bell24h-OS";
metadata.description = "Enterprise AI Orchestration and Content Generation Platform";
fs.writeFileSync('metadata.json', JSON.stringify(metadata, null, 2));
