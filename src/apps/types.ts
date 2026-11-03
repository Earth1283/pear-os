import type { ComponentType } from 'react'
import type { AppSpec, Win } from '../store'

export type MenuItem =
  | 'sep'
  | {
      label: string
      shortcut?: string
      disabled?: boolean
      checked?: boolean
      action?: (win: Win | null) => void
      submenu?: MenuItem[]
    }

export interface MenuDef {
  title: string
  items: MenuItem[]
}

export interface AppDef extends AppSpec {
  component: ComponentType<{ win: Win }>
  chrome?: 'standard' | 'overlay'
  menus?: MenuDef[]
  inDock?: boolean
  hidden?: boolean
}
