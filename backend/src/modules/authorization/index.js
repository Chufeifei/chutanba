const { syncFromConfig, getCapabilities } = require('./service');
const { assertCapability, assertAnyCapability } = require('./guards');

module.exports = { syncFromConfig, getCapabilities, assertCapability, assertAnyCapability };
