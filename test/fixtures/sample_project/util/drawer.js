const drawer = {
  pop(options, callback) {
    return this.open(options, callback);
  },

  open(options, callback) {
    return callback && callback({});
  },

  close() {
    return true;
  }
};

module.exports = drawer;
