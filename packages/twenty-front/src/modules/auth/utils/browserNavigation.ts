export const replaceBrowserLocation = (url: string) => {
  window.location.replace(url);
};

export const navigateBrowserTo = (url: string) => {
  window.location.href = url;
};
