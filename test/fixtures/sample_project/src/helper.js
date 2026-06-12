const helper = {
  validate(source) {
    return this.check(source);
  },

  check(value) {
    return value !== '';
  },

  transform(data, name) {
    return data + '_' + name;
  }
};

module.exports = helper;
