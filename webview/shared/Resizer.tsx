/** Drag handle between panes; reports the pointer delta along its axis while dragging. */
export function Resizer({ axis, onResize }: { axis: 'x' | 'y'; onResize(delta: number): void }) {
  const start = (down: MouseEvent) => {
    down.preventDefault();
    let last = axis === 'x' ? down.clientX : down.clientY;
    const move = (event: MouseEvent) => {
      const current = axis === 'x' ? event.clientX : event.clientY;
      onResize(current - last);
      last = current;
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  };
  return <div class={`resizer resizer-${axis}`} onMouseDown={start} />;
}
