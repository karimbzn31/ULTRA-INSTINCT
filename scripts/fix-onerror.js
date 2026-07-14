import fs from 'fs';
let html = fs.readFileSync('views/client-detail.html', 'utf8');

// Fix onerror issues
html = html.replace(/onerror="this.style.display=\\'none\\'"/g, 'onerror="this.hidden=true"');
html = html.replace(/onerror="this.style.display='none'"/g, 'onerror="this.hidden=true"');

// Check if there's still the old renderProducts function (line 130 area)
// The old one uses p.image with single quotes
// We already replaced it, but just in case

fs.writeFileSync('views/client-detail.html', html);
console.log('✅ onerror fixes done');
