import { create } from 'zustand';

export type ModalName =
  | null
  | 'settings'
  | 'createServer'
  | 'joinServer'
  | 'inviteManager'
  | 'serverSettings'
  | 'createChannel'
  | 'notifications'
  | 'userProfile';

export type MainView = 'server' | 'dms' | 'friends';

export interface ToastEntry {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export interface ReplyTarget {
  contextId: string;
  messageId: string;
  authorName: string;
  snippet: string;
}

interface UiState {
  modal: ModalName;
  /** Argument for argumented modals (e.g. userId for 'userProfile'). */
  modalArg: string | null;
  /** Active reply target for channel/DM composer. */
  replyTarget: ReplyTarget | null;
  theme: 'dark' | 'light';
  mainView: MainView;
  memberSidebarOpen: boolean;
  toasts: ToastEntry[];
  openModal: (modal: ModalName, arg?: string) => void;
  closeModal: () => void;
  setReplyTarget: (target: ReplyTarget | null) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setMainView: (view: MainView) => void;
  toggleMemberSidebar: () => void;
  pushToast: (message: string, tone?: 'info' | 'error') => void;
  dismissToast: (id: number) => void;
}

function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('mahyar_gap_theme', theme);
}

export const useUiStore = create<UiState>((set, get) => ({
  modal: null,
  modalArg: null,
  replyTarget: null,
  theme: (localStorage.getItem('mahyar_gap_theme') as 'dark' | 'light') ?? 'dark',
  mainView: 'server',
  memberSidebarOpen: true,
  toasts: [],
  openModal: (modal, arg) => set({ modal, modalArg: arg ?? null }),
  closeModal: () => set({ modal: null, modalArg: null }),
  setReplyTarget: (target) => set({ replyTarget: target }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setMainView: (view) => set({ mainView: view }),
  toggleMemberSidebar: () => set({ memberSidebarOpen: !get().memberSidebarOpen }),
  pushToast: (message, tone = 'info') => {
    const id = Date.now() + Math.random();
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 4200);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

// Apply persisted theme at startup.
applyTheme(useUiStore.getState().theme);
