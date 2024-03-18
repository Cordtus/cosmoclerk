// sessionUtils.js
const userLastAction = new Map();
const expectedAction = new Map();

const updateUserLastAction = (userId, data) => {
  if (data === null) {
    userLastAction.delete(userId.toString());
  } else {
    userLastAction.set(userId.toString(), data);
  }
};

const updateExpectedAction = (userId, action) => {
  if (action === null) {
    expectedAction.delete(userId.toString());
  } else {
    expectedAction.set(userId.toString(), action);
  }
};

module.exports = { updateUserLastAction, updateExpectedAction, userLastAction, expectedAction };

