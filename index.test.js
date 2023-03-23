const RenpyCounter = require('./index.js');

const simpleParser = (t) => {
    const w = t.split(' ');
    return w[w.length - 1].length - 2;
};
const simpleAggregator = (tx) => {
    return tx.reduce((a, b) => a + b, 0);
};
const parse = (verse) => {
    const counter = new RenpyCounter(simpleParser, simpleAggregator);
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
const anal = (verse) => {
    const counter = parse(verse);
    counter.optimize();
    return counter.analyze();
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

describe('forceful', () => {
    test('jump', () => {
        expect(bbSize(`
"a"
label tst:
    jump .x
label .x:
    "a"
`)).toEqual(3);
    });
    test('return', () => {
        expect(bbSize(`
"a"
label tst:
    return .x
label .x:
    "a"
`)).toEqual(2);
    });
});

describe('analyze', () => {
    test('simple', () => {
        expect(anal(`
"ae"
"abe"
"abde"
`)).toEqual([9, 9]);
    });
    test('if', () => {
        expect(anal(`
"ae"
if xx:
    "abe"
"abde"
`)).toEqual([6, 9]);
    });
    test('if-else', () => {
        expect(anal(`
label sh:
    "ae"
    if xx:
        "abe"
    else:
        "abecadsf"
    if xx:
        "abe"
    else:
        "af"
    "abde"
`)).toEqual([11, 17]);
    });
    test('loop', () => {
        expect(anal(`
"ae"
label again:
menu:
    "choice 1":
        "ae"
    "choice 2":
        "xxx"
        jump again
    "choice 3":
        "xxx"
"abde"
`)).toEqual([8, 12]);
    });
    test('deadend', () => {
        expect(anal(`
"ae"
label again:
menu:
    "choice 1":
        "ae"
    "choice 2":
        "xxx"
        jump again
    "choice 3":
        return False # deadend
"abde"
`)).toEqual([8, 11]);
    });
});
