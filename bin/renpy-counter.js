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
      line = line.substring(1);
    }
    ++i;
    debug(`Line from file: ${i}:${line}`);
    counter.parseLine(line, i);
  }
  const ncjkSpeed = 582.9; // chs/min
  const cjkSpeed = 110.0; // chs/min
  counter.optimize(ncjkSpeed, cjkSpeed);
  const [minT, minP] = counter.spfa();
  const [maxT, maxP] = counter.kosaraju();
  console.log(`Assuming Non-CJK reading time is ${ncjkSpeed} characters per minute.`);
  console.log(`Assuming CJK reading time is ${cjkSpeed} characters per minute.`);
  console.log(`Minimum time to read: ${minT} min`);
  console.log(`Maximum time to read: ${maxT} min`);
  console.log(minP);
  console.log(maxP);
}
run();
