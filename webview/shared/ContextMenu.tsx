import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MenuItem } from '../../src/protocol/log';
import { Icon } from './Icon';
import { classes } from './format';
import { Store, useStore } from './store';

interface MenuState {
  open?: { x: number; y: number; items: MenuItem[]; onInvoke(id: string): void };
}

class MenuStore extends Store<MenuState> {
  private request = 0;

  /** Opens a menu at the pointer once its items arrive; a newer request wins. */
  async show(event: MouseEvent, items: Promise<MenuItem[]>, onInvoke: (id: string) => void): Promise<void> {
    event.preventDefault();
    const request = ++this.request;
    const { clientX: x, clientY: y } = event;
    const resolved = await items;
    if (request === this.request && resolved.length > 0) this.set({ open: { x, y, items: resolved, onInvoke } });
  }

  close(): void {
    this.request++;
    if (this.state.open) this.set({ open: undefined });
  }
}

export const contextMenu = new MenuStore({});

/** Renders the active context menu; mount once near the root. */
export function ContextMenuHost() {
  const { open } = useStore(contextMenu);
  useEffect(() => {
    if (!open) return;
    const close = () => contextMenu.close();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  const invoke = (id: string) => {
    contextMenu.close();
    open.onInvoke(id);
  };
  return <MenuList items={open.items} x={open.x} y={open.y} onInvoke={invoke} />;
}

function MenuList(props: { items: MenuItem[]; x: number; y: number; anchorWidth?: number; onInvoke(id: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });
  const [submenu, setSubmenu] = useState<{ index: number; x: number; y: number; width: number }>();

  // Keep the menu inside the viewport; submenus flip to the left of their parent.
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    let left = props.x;
    if (left + box.width > window.innerWidth) {
      left = props.anchorWidth !== undefined ? props.x - props.anchorWidth - box.width : window.innerWidth - box.width - 4;
    }
    const top = Math.min(props.y, window.innerHeight - box.height - 4);
    setPosition({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [props.x, props.y, props.items]);

  return (
    <div ref={ref} class="menu" style={position} onMouseDown={(event) => event.stopPropagation()}>
      {props.items.map((item, index) => {
        if (item.separator) return <div class="menu-separator" />;
        const enter = (event: MouseEvent) => {
          if (!item.children) return setSubmenu(undefined);
          const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
          setSubmenu({ index, x: box.right, y: box.top - 4, width: box.width });
        };
        return (
          <div
            class={classes('menu-item', item.disabled !== undefined && 'disabled', submenu?.index === index && 'active')}
            title={item.disabled}
            onMouseEnter={enter}
            onClick={() => item.id && item.disabled === undefined && props.onInvoke(item.id)}
          >
            <span class="menu-label">{item.label}</span>
            {item.children && <Icon name="chevron-right" />}
          </div>
        );
      })}
      {submenu && props.items[submenu.index].children && (
        <MenuList
          items={props.items[submenu.index].children!}
          x={submenu.x}
          y={submenu.y}
          anchorWidth={submenu.width}
          onInvoke={props.onInvoke}
        />
      )}
    </div>
  );
}
