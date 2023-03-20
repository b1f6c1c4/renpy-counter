const RenpyCounter = require('./index.js');

const parse = (verse) => {
    const counter = new RenpyCounter();
    verse.split('\n').forEach((line, id) => {
        counter.parseLine(line, id);
    });
    return counter;
};
const failing = (verse) => () => parse(verse);
const bbSize = (verse) => {
    const counter = parse(verse);
    counter.optimize();
    return counter.bbSize();
}

describe('indent', () => {
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
    test('weird2', () => {
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
    test('nested', () => {
        expect(bbSize(`
a "hello" #1
menu:
    "choice1" if a:
        #2fake
        menu:
            "cho": #3
                "kk"
            "choo": #4
                "gg"
        #5fake
    "choice1" if b:
        c "world" #6
d "done" #7
`)).toEqual(7);
    });
});

describe('if', () => {
    test('simple', () => {
        expect(bbSize(`
a "hello"
if kk:
    b "hello"
c "world"
`)).toEqual(3);
    });
    test('if-else', () => {
        expect(bbSize(`
a "hello"
if kk:
    b "hello"
else:
    c "hello"
d "world"
`)).toEqual(4);
    });
    test('if-elif-else', () => {
        expect(bbSize(`
a "hello"
if kk:
    b "hello"
elif mm:
    b "hello"
else:
    c "hello"
d "world"
`)).toEqual(5);
    });
    test('nested', () => {
        expect(bbSize(`
a "hello" #1
if kk:
    b "hello" #2
else:
    #3fake
    if gg:
        c "hello" #4
    else:
        k "xx" #5
    #6fake
d "world" #7
`)).toEqual(7);
    });
    test('nested-else', () => {
        expect(bbSize(`
a "hello" #1
if kk:
    b "hello" #2
    if gg:
        c "hello" #3
    else:
        k "xx" #4
    #5fake
d "world" #6
`)).toEqual(6);
    });
    test('nested-else', () => {
        expect(bbSize(`
a "hello" #1
if kk:
    b "hello" #2
    if gg:
        c "hello" #3
    #4fake
else:
    k "xx" #5
d "world" #6
`)).toEqual(6);
    });
});

describe('label', () => {
    test('no-scope-label', () => {
        expect(failing(`
label .x:
`)).toThrow();
    });
    test('no-scope-jump', () => {
        expect(failing(`
jump .x
`)).toThrow();
    });
    test('dup', () => {
        expect(failing(`
label tst:
    label .x:
label .x:
`)).toThrow();
    });
});

describe('jump', () => {
    test('jump', () => {
        expect(bbSize(`
"a"
label tst:
    jump .x
label .x:
    "a"
`)).toEqual(3);
    });
});
