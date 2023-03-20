const RenpyCounter = require('./index.js');

const count = (verse) => {
  const counter = new RenpyCounter();
  verse.split('\n').forEach((line, id) => {
    counter.parseLine(line, id);
  });
  return counter;
};

describe('parser', () => {
  describe('indent', () => {
    const failing = (verse) => () => count(verse);
    test('init', () => {
      expect(failing(`
  a "hello"
`)).toThrow();
    });
    test('not colon', () => {
      expect(failing(`
a "hello"
  b "world"
`)).toThrow();
    });
    test('not full', () => {
      expect(failing(`
label hello:
  b "world"
 b "world"
`)).toThrow();
    });
  });
});
