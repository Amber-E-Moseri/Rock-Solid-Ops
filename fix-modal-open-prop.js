#!/usr/bin/env node

/**
 * Fix Modal open prop in all SPA pages.
 * The Modal component requires an `open` prop to render.
 * This script converts:
 *   {condition && <Modal ...></Modal>}
 * To:
 *   <Modal open={!!condition} ...></Modal>
 */

const fs = require('fs');
const path = require('path');

const features = [
  'graduation-status',
  'makeup-management',
  'fellowship-management',
  'teacher-schedule',
  'nexus-management',
  'teacher-management',
  'batch-management',
  'admin-management',
  'class-editor',
  'email-campaigns',
  'failed-sync-retry-center',
  'messages',
  'milestones-admin',
  'reports',
  'teacher-attendance',
  'waitlist',
];

const spaRoot = path.resolve(__dirname, 'foundation-spa/src/features');

function fixFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Pattern: {someVar && (<Modal ...>...</Modal>)}
  // We need to extract the condition variable and ensure Modal has open prop

  let fixed = content;

  // Find all Modal tags without open prop
  const modalRegex = /<Modal\s+(?!open\s*=)([^>]*?)>/g;

  fixed = fixed.replace(modalRegex, (match, attrs) => {
    // Check if Modal already has open prop
    if (/\bopen\s*=/.test(match)) return match;

    // Insert open={true} as placeholder - will be replaced by condition
    return `<Modal open={true} ${attrs}>`;
  });

  // Now handle the conditional wrappers
  // Pattern: {condition && (<Modal...></Modal>)}
  const conditionalRegex = /\{(\w+)\s*&&\s*\(\s*<Modal([^>]*?)>/g;

  fixed = fixed.replace(conditionalRegex, (match, condition, attrs) => {
    // Replace open={true} with open={!!condition}
    attrs = attrs.replace(/open={true}/, `open={!!${condition}}`);

    // If Modal has title that might reference the condition, keep it but wrap in conditional
    const titleRegex = /title={`.*?\${(\w+).*?`}/;
    if (titleRegex.test(attrs)) {
      attrs = attrs.replace(titleRegex, (m) => {
        if (m.includes(`\${${condition}}`)) {
          // title references the condition, make it safe
          m = m.replace(/`([^`]*)`/, `\`${condition} ? '$1' : ''\``);
        }
        return m;
      });
    }

    return `{${condition} && (<Modal${attrs}>`;
  });

  // Remove the trailing closing parenthesis of conditional
  fixed = fixed.replace(/\s*\)\s*\}\s*$/gm, (match, pos) => {
    // Check if this is closing a conditional Modal
    if (fixed.substring(Math.max(0, pos - 100), pos).includes('<Modal open={')) {
      return '\n      </Modal>\n    ';
    }
    return match;
  });

  if (fixed !== content) {
    console.log(`✓ Fixed: ${filePath}`);
    fs.writeFileSync(filePath, fixed);
    return true;
  }

  return false;
}

function main() {
  let count = 0;

  features.forEach(feature => {
    const featurePath = path.join(spaRoot, feature);
    if (!fs.existsSync(featurePath)) {
      console.log(`✗ Feature not found: ${feature}`);
      return;
    }

    const pageFile = path.join(featurePath, `${feature.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}Page.jsx`);

    if (fs.existsSync(pageFile)) {
      if (fixFile(pageFile)) count++;
    }
  });

  console.log(`\n✓ Fixed ${count} files`);
}

main();
