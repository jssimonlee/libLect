'use strict';

global.window = {};
require('../rules-data.js');
const { rankEntries, makeAnswerExtract } = require('../rules-search.js');
const questions = [
    ...require('./rules-search-questions.js'),
    ...require('./rules-search-general-questions.js'),
];

if (questions.length !== 150) throw new Error(`Expected 150 questions, received ${questions.length}`);

const start = Math.max(0, Number(process.argv[2] || 1) - 1);
const end = Math.min(questions.length, Number(process.argv[3] || questions.length));

questions.slice(start, end).forEach((query, offset) => {
    const index = start + offset;
    const { analysis, ranked } = rankEntries(query, 'all', 3);
    const first = ranked[0]?.entry;
    const answer = first && analysis.intents.length ? makeAnswerExtract(first, analysis, query) : '';
    console.log([
        String(index + 1).padStart(3, '0'),
        query,
        first?.title || 'NO_RESULT',
        analysis.intents.map(intent => intent.id).join(','),
        answer.slice(0, 100).replace(/\s+/g, ' '),
    ].join('\t'));
});
