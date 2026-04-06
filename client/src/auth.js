const setToken = (token) => {
  localStorage.setItem("token", token);
};

const clearToken = () => {
  localStorage.removeItem("token");
};

const getToken = () => localStorage.getItem("token");

export { setToken, clearToken, getToken };
