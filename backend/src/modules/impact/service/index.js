const records = require('./records');
const review = require('./review');

module.exports = { ...records, ...review };
