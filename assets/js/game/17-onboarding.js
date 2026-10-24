// Type-R 198X — ONBOARD track (D13): the first-run Flight Check (three scripted plates in mode "playing" with
// this.run === null and throwaway stats, a reduced update claimed through frameWillUpdate, one storeSave at the end) and
// the briefing disclosure. Loads after 15-screens.js. Hooks consumed: runWillStart, levelWillStart, frameWillUpdate,
// modeChange, keyEscape, scoreWillAdd, powerupWillSpawn, storyWillShow (pauseScreenFilled optional); emitted:
// flightCheckStart, flightCheckStep, flightCheckEnd. Top-level names FC_* / fc*; methods never reuse the 15-screens.js
// onboarding names (initOnboarding, tutorialEnabled, markTutorial, tutorialToast, dismissTutorialToast).
