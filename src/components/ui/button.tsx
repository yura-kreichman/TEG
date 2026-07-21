import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Лёгкий градиент + тень "объёма" в рамках акцентного цвета
        // (фидбек пользователя 2026-07-09: "больше эффекта объёма для
        // объектов по которым кликаем"). Изначально было только для
        // primary-CTA — расширено на все контролы-"поверхности" (запрос
        // пользователя 2026-07-14: "все контролы кнопок, переключателей и
        // т.п. с небольшой глубиной, как у переключателя"), кроме ghost/link —
        // у них нет заливки/поверхности, класть тень некуда. Тот же
        // трёхслойный bevel (внешняя тень + верхний блик + нижнее затемнение),
        // что и у variant="outline" (запрос пользователя 2026-07-22: "на всех
        // синих кнопках глубину по аналогии, синие остаются синими") — цвет/
        // градиент/brightness не тронуты, добавлен только третий слой (нижнее
        // inset-затемнение), которого раньше не было.
        default:
          "bg-linear-to-b from-primary to-[color-mix(in_oklch,var(--primary),black_14%)] text-primary-foreground shadow-[0_2px_5px_rgba(0,0,0,.2),inset_0_1px_0_rgba(255,255,255,.22),inset_0_-2px_3px_rgba(0,0,0,.14)] hover:brightness-105 hover:shadow-[0_3px_7px_rgba(0,0,0,.24),inset_0_1px_0_rgba(255,255,255,.24),inset_0_-2px_3px_rgba(0,0,0,.16)] active:brightness-95 active:shadow-[0_1px_2px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.14),inset_0_-1px_2px_rgba(0,0,0,.16)]",
        // Тот же выраженный "объёмный" bevel, что раньше был только у
        // SaveButton (src/components/ui/save-button.tsx) — запрос
        // пользователя 2026-07-22 по скриншоту кнопки "Сохранить" в
        // Инструктажах: "такой дизайн должен быть у всех белых кнопок в
        // проекте", решение расширено с одной кнопки на весь variant.
        // Интенсивность снижена тем же вечером ("глубину сделай немного
        // меньше") — сама тень остаётся, просто мягче исходной.
        outline:
          "border-border bg-background shadow-[0_2px_5px_rgba(0,0,0,.15),inset_0_1px_0_rgba(255,255,255,.18),inset_0_-1px_2px_rgba(0,0,0,.09)] hover:bg-muted hover:text-foreground hover:shadow-[0_3px_7px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.2),inset_0_-1px_2px_rgba(0,0,0,.1)] active:shadow-[0_1px_2px_rgba(0,0,0,.13),inset_0_1px_0_rgba(255,255,255,.13),inset_0_-1px_2px_rgba(0,0,0,.1)] aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-linear-to-b from-secondary to-[color-mix(in_oklch,var(--secondary),black_6%)] text-secondary-foreground shadow-[0_1px_2px_rgba(0,0,0,.08),inset_0_1px_0_rgba(255,255,255,.3)] hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:shadow-[inset_0_1px_2px_rgba(0,0,0,.1)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive shadow-[0_1px_2px_rgba(0,0,0,.05),inset_0_1px_0_rgba(255,255,255,.25)] hover:bg-destructive/20 active:shadow-[inset_0_1px_2px_rgba(0,0,0,.08)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // Радиус НЕ переопределяется по размеру (запрос пользователя
        // 2026-07-20: "радиус этих кнопок надо поменять по всему проекту,
        // должны быть единообразны везде") — раньше xs/sm/icon-xs/icon-sm
        // ужимали унаследованный от базового класса rounded-lg (10px,
        // var(--radius)) до 8px через rounded-[min(var(--radius-md),Npx)],
        // из-за чего одинаковые по смыслу кнопки в разных местах проекта
        // визуально отличались; теперь все размеры используют один и тот же
        // базовый rounded-lg.
        xs: "h-6 gap-1 px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
