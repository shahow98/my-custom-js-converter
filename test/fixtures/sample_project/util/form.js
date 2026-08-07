const form = {
  setValue(key, value) {
    return this.saveValue(key, value);
  },

  saveValue(key, value) {
    return value;
  }
};

module.exports = form;
