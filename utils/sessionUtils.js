// sessionUtils.js

const userLastAction = new Map();
const expectedAction = new Map();


function updateUserLastAction(userId, data) {
  if (data !== null) {
      userLastAction.set(userId, {
          ...userLastAction.get(userId), // Spread the existing user action if any
          ...data,
          timestamp: new Date() // Adds a timestamp to each action
      });
  } else {
      // If data is null, delete the user's last action
      userLastAction.delete(userId);
  }
}

function updateExpectedAction(userId, action) {
    if (action !== null) {
        expectedAction.set(userId, action);
    } else {
        expectedAction.delete(userId);
    }
}

module.exports = { updateUserLastAction, updateExpectedAction, userLastAction, expectedAction };
