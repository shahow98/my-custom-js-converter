const util = require('@/src/util/index');
const helper = require('./helper');

const customEvent = {
  init() {
    this.loadData();
    util.formatData('init');
    helper.validate('init');
  },

  loadData() {
    return util.fetchData();
  },

  process(name) {
    const data = this.loadData();
    return helper.transform(data, name);
  }
};

module.exports = customEvent;
