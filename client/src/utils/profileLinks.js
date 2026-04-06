export const toProfilePath = (user) => {
  if (!user) return null;

  const handle = user.username?.trim();
  if (handle) return `/users/@${handle}`;

  const id = user.id;
  if (id === null || id === undefined || id === "") return null;

  return `/users/${id}`;
};

export const resolveProfileId = async (identifier, api) => {
  if (!identifier) return null;
  if (!identifier.startsWith("@")) return identifier;

  const username = identifier.slice(1).trim();
  if (!username) return null;

  const res = await api.get(`/users/search?q=${encodeURIComponent(username)}`);
  const match = res.data.find(
    (candidate) => candidate.username?.toLowerCase() === username.toLowerCase()
  );
  return match?.id ?? null;
};
