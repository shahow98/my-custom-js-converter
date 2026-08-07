const util = require('@/src/util/index');
const helper = require('./helper');
const drawer = require('@/util/drawer');
const form = require('@/util/form');

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
  },

  onClickPickLevel() {
    drawer.pop({
      title: "关联信息",
      size: "65%",
      name: "store",
      param: {}
    }, resp => {
      Object.keys(resp).forEach(key => {
        form.setValue(`${key}`, resp[key]);
      });
    });
  }
};

module.exports = customEvent;
