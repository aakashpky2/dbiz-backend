const fs = require('fs');
const path = require('path');

const permissionsMap = {
    'proposals.js': 'MANAGE_PROPOSALS',
    'rate-cards.js': 'MANAGE_RATE_CARDS',
    'government-fees.js': 'MANAGE_GOVERNMENT_FEES',
    'templates.js': 'MANAGE_TEMPLATES',
    'template-configurations.js': 'MANAGE_TEMPLATE_CONFIGURATIONS',
    'client-workflows.js': 'MANAGE_WORKFLOWS',
    'dsc.js': 'MANAGE_DSC'
};

const routesDir = path.join(__dirname, '../routes');

for (const [filename, permission] of Object.entries(permissionsMap)) {
    const filePath = path.join(routesDir, filename);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filename}`);
        continue;
    }

    let content = fs.readFileSync(filePath, 'utf-8');

    // Add requirePermission import if not present
    if (!content.includes('requirePermission')) {
        content = content.replace(
            /(const express = require\('express'\);\s*const router = express.Router\(\);\s*)/,
            `$1const { requirePermission } = require('../lib/permissions');\n`
        );
    }

    // Process lines
    const lines = content.split('\n');
    let protectedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Match router.(post|put|patch|delete)('...', async (req, res)
        // OR router.(post|put|patch|delete)('...', (req, res)
        const regex = /^(router\.(?:post|put|patch|delete)\s*\(\s*['"][^'"]+['"]\s*,\s*)(async\s*\(req,\s*res\)|req,\s*res\s*=>|\(req,\s*res\)\s*=>)/;
        
        if (regex.test(line)) {
            // Check if it's already protected
            if (!line.includes('requirePermission')) {
                lines[i] = line.replace(regex, `$1requirePermission('${permission}'), $2`);
                protectedCount++;
            }
        }
    }

    if (protectedCount > 0) {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        console.log(`Updated ${filename}: Added protection to ${protectedCount} endpoints with ${permission}`);
    } else {
        console.log(`Skipped ${filename}: No changes needed or already protected.`);
    }
}
