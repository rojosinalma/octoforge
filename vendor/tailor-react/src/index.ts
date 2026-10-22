/* managed by tailor v0.11.1 — tailor-react src/index.ts — do not edit, run `tailor sync` */
// tailor-react — the component API over the tailor markup vocabulary.
// `import { Ui } from "tailor-react"` and render `<Ui.Button>`, `<Ui.Field>`, …
// Default path renders the exact tailor markup (core/components.json); the kit
// adapters under adapters/<kit>/ render the same API through a component kit.
import {
  AppShell, Navbar, Sidebar, Footer, Page, Section, Toolbar,
  Grid, Stack, Cluster, Split,
} from "./shell.tsx";
import {
  Icon, Button, ButtonGroup, Segmented, Menu, Tabs, Breadcrumb, Pagination, List,
} from "./actions.tsx";
import {
  Label, Input, Select, Textarea, InputGroup, InputAddon,
  Field, Check, CheckGroup, DurationInput, Settings, SettingsRow, Form,
} from "./forms.tsx";
import {
  Badge, Counter, Chip, StateLabel, Dot, Avatar, Table, Card, Facts,
  StatLabel, StatValue, StatSub, StatBox, EmptyState, Timeline, RelativeTime,
} from "./data.tsx";
import {
  Tooltip, Help, Code, Truncate, Alert, Toast, ToastRegion, Dialog, Confirm,
  Progress, Spinner, UiProvider,
} from "./feedback.tsx";
import { Pickers } from "./theme.tsx";

export const Ui = {
  // shell & layout
  AppShell, Navbar, Sidebar, Footer, Page, Section, Toolbar, Grid, Stack, Cluster, Split,
  // actions & navigation
  Icon, Button, ButtonGroup, Segmented, Menu, Tabs, Breadcrumb, Pagination, List,
  // forms
  Label, Input, Select, Textarea, InputGroup, InputAddon,
  Field, Check, CheckGroup, DurationInput, Settings, SettingsRow, Form,
  // data display
  Badge, Counter, Chip, StateLabel, Dot, Avatar, Table, Card, Facts,
  StatLabel, StatValue, StatSub, StatBox, EmptyState, Timeline, RelativeTime,
  // feedback
  Tooltip, Help, Code, Truncate, Alert, Toast, ToastRegion, Dialog, Confirm, Progress, Spinner,
  // theme switcher (skin / palette selects + sun/moon toggle; the React Tailor.theme)
  Pickers,
  // provider
  Provider: UiProvider,
};

export type UiComponents = typeof Ui;

export { UiProvider };
export { useToasts, useOptionalToasts, useConfirm, type HelpProps, type DialogProps, type ToastTone } from "./feedback.tsx";
export type {
  InputProps, SelectProps, FieldProps, FormProps, CheckProps, DurationInputProps, SettingsProps, SettingsRowProps,
  SaveResult, SaveFn,
} from "./forms.tsx";
export type { SortDir } from "./data.tsx";
export type { ButtonProps, MenuProps, MenuItemProps, TabsProps, SegmentedProps, ListProps, ListItemProps, IconProps } from "./actions.tsx";
export type { AppShellProps } from "./shell.tsx";
export { popup } from "./popup.ts";
export { relativeTime } from "./data.tsx";
export { cx, type Tone, type Size } from "./util.ts";
export {
  useTailorTheme, setTailorTheme, themeOptions, modeToggle, Pickers, PickerControls,
  type TailorTheme, type TailorThemeConfig, type TailorThemeState, type TailorThemeChange, type PickersProps, type PickerPart,
  type ThemeMode, type ModeChoice,
} from "./theme.tsx";
