'use strict';

function parseLaunchOptions(argv = []) {
  const args = Array.from(argv || [], (value) => String(value || '').trim()).filter(Boolean);
  const background = args.includes('--background');
  const showSettings = args.includes('--show-settings');
  const start = args.includes('--start');
  const stop = args.includes('--stop');
  const ownerArg = args.find((value) => value.startsWith('--owner='));
  const requestedOwner = String(ownerArg?.slice('--owner='.length) || '').trim().toLowerCase();
  const owner = background && requestedOwner === 'tracker' ? 'tracker' : 'standalone';
  return { background, showSettings, start, stop, owner };
}

function secondInstanceAction(argv = []) {
  const options = parseLaunchOptions(argv);
  const hasExplicitCommand = options.showSettings || options.start || options.stop || options.background;
  return {
    ...options,
    showSettings: options.showSettings || !hasExplicitCommand,
    promoteToStandalone: !hasExplicitCommand
  };
}

module.exports = { parseLaunchOptions, secondInstanceAction };
