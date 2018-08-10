const _SVGS = require.context('../assets/svgs', true, /\.svg$/);

export default _SVGS.keys().reduce((images, key) => {
  let _key = key.split('./')[1].split('.svg')[0];
  images[_key] = _SVGS(key);
  return images;
}, {});