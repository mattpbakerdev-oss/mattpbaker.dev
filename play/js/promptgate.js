// The interact prompt's show and hide, without the DOM, so node can test it. A hide lets the exit
// transition play (`leave`), then takes the prompt away (`gone`). A repeat hide is a no-op that
// keeps the pending exit: cancelling it left an invisible, tappable prompt over the banner.
export function createPromptGate({ delay, show, leave, gone, schedule = setTimeout, cancel = clearTimeout }) {
  let place = null;    // what the prompt shows (null while hidden or leaving)
  let hidden = true;   // out of the layout and the tab order
  let timer = null;
  const finish = () => { timer = null; hidden = true; gone(); };
  return {
    get place() { return place; },
    set(next) {
      if (!next) {
        if (!place) return;
        place = null;
        leave();
        if (delay > 0) timer = schedule(finish, delay);
        else finish();
        return;
      }
      if (timer !== null) { cancel(timer); timer = null; }
      const fromHidden = hidden;
      place = next;
      hidden = false;
      show(next, fromHidden);
    },
  };
}
