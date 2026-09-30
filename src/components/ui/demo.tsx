import { ThemeToggle } from "@/components/ui/theme-toggle"
import { SquareWaveLoader } from "@/components/ui/square-wave-loader"

function DefaultToggle() {
  return (
    <div className="space-y-2 text-center">
      <div className="flex justify-center">
        <ThemeToggle />
      </div>
    </div>
  )
}

function DemoOne() {
  return (
    <div className="flex min-h-[300px] w-full items-center justify-center bg-white text-black transition-colors duration-300 dark:bg-zinc-950 dark:text-white">
      <SquareWaveLoader count={5} size={14} />
    </div>
  )
}

export { DefaultToggle, DemoOne }
