const RenpyCounter = require('./index.js');

const parse = (verse) => {
    const counter = new RenpyCounter();
    verse.split('\n').forEach((line, id) => {
        counter.parseLine(line, id);
    });
    return counter;
};
const bbSize = (verse) => {
    const counter = parse(verse);
    counter.optimize();
    return counter.bbSize();
}

describe('parser', () => {
    describe('indent', () => {
        const failing = (verse) => () => parse(verse);
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

describe('non-forking', () => {
    test('simple', () => {
        expect(bbSize(`
a "hello"
whatever:
    b "world"
c "done"
`)).toEqual(1);
    });
    test('label-indent', () => {
        expect(bbSize(`
a "hello"
label xx:
    b "world"
c "done"
`)).toEqual(2);
    });
    test('label-no-indent', () => {
        expect(bbSize(`
a "hello"
label xx:
b "world"
c "done"
`)).toEqual(2);
    });
});

describe('menu', () => {
    test('simple', () => {
        expect(bbSize(`
a "hello"
menu:
    "choice1" if a:
        b "world"
    "choice1" if b:
        c "world"
d "done"
`)).toEqual(4);
    });
    test('weird', () => {
        expect(bbSize(`
a "hello"
menu:
    "choice1" if a:
        label qq:
            b "world"
    "choice1" if b:
        c "world"
d "done"
`)).toEqual(4);
    });
})
