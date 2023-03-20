const fs = require('node:fs');
const readline = require('node:readline');
const RenpyCounter = require('../index.js');
const debug = require('debug')('renpy-counter:bin');

const rl = readline.createInterface({
  input: fs.createReadStream(process.argv[2]),
  crlfDelay: Infinity,
});

const counter = new RenpyCounter();

async function run() {
  let i = 0;
  for await (let line of rl) {
    if (line.charCodeAt(0) === 0xFEFF) {
      line = line.substr(1);
    }
    ++i;
    debug(`Line from file: ${i}:${line}`);
    counter.parseLine(line, i);
  }
}
run();
