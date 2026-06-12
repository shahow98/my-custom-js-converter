const util = {
  fetchData() {
    return 'fetched_data';
  },

  formatData(source) {
    return this.parseData(source);
  },

  parseData(raw) {
    return raw + '_parsed';
  }
};

module.exports = util;
