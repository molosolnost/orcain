/**
 * Common utilities for sim scenarios. Re-exports from sim_utils and adds
 * connectClient(port) that creates a fresh guest account and connects.
 */
const simUtils = require('../lib/sim_utils');
const db = require('../../db');

async function connectClient(port) {
  const acc = db.createGuestAccount();
  return simUtils.connectClient(port, acc);
}

module.exports = {
  ...simUtils,
  connectClient
};
