#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const postcss = require('postcss')
const tailwind = require('@tailwindcss/postcss')

async function main() {
  const inputPath = path.resolve(__dirname, '../src/index.css')
  const outputPath = path.resolve(__dirname, '../dist/index.css')
  const input = fs.readFileSync(inputPath, 'utf-8')
  const result = await postcss([tailwind]).process(input, {
    from: inputPath,
    to: outputPath,
  })
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, result.css)
  console.log('CSS built successfully')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
