import fs from 'fs';

// Update engine.js prompt
let engine = fs.readFileSync('bot/engine.js', 'utf8');
engine = engine.replace(
  "chaleureux(se), professionnel(le",
  "professionnel(le"
);
engine = engine.replace(
  "sansblabla.",
  "sans blabla."
);
fs.writeFileSync('bot/engine.js', engine);

// Update client-detail prompt
let html = fs.readFileSync('views/client-detail.html', 'utf8');
html = html.replace(
  "assistant commercial chaleureux et professionnel",
  "vendeur direct et professionnel"
);
fs.writeFileSync('views/client-detail.html', html);

console.log('Prompts mis a jour');
