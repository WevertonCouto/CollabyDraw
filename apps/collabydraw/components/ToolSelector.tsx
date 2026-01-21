import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { ToolType } from "@/types/canvas"
import { tools } from "@/types/Tools"

interface ToolSelectorProps {
    selectedTool: ToolType
    onToolSelect: (tool: ToolType) => void
    isReadOnly?: boolean
}

export default function ToolSelector({ selectedTool, onToolSelect, isReadOnly = false }: ToolSelectorProps) {
    return (
        <TooltipProvider delayDuration={0}>
            <header className="Tool_Bar flex items-center gap-1 p-1.5 rounded-lg Island">
                <div className="flex items-center gap-1 lg:gap-3">
                    {tools.map((tool) => {
                        // In read-only mode, only allow grab tool, disable all others
                        const isToolDisabled = isReadOnly && tool.type !== "grab";
                        // If tool is disabled and currently selected, switch to grab
                        const shouldForceGrab = isReadOnly && selectedTool !== "grab" && tool.type === "grab";
                        
                        return (
                            <Tooltip key={tool.type}>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={selectedTool === tool.type ? "secondary" : "ghost"}
                                        size="icon"
                                        onClick={() => {
                                            if (!isToolDisabled) {
                                                onToolSelect(tool.type);
                                            } else if (shouldForceGrab) {
                                                onToolSelect("grab");
                                            }
                                        }}
                                        disabled={isToolDisabled}
                                        className={`xl:relative w-[30px] h-[30px] xs670:w-9 xs670:h-9 ${selectedTool === tool.type ? 'bg-selected-tool-bg-light text-[var(--color-on-primary-container)] dark:bg-selected-tool-bg-dark dark:text-white' : 'text-icon-fill-color hover:text-icon-fill-color dark:text-icon-fill-color-d dark:hover:text-icon-fill-color-d hover:bg-light-btn-hover-bg dark:hover:bg-d-btn-hover-bg'} ${isToolDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        {tool.icon}
                                        <span className="sr-only">{tool.label}</span>
                                        <span className="hidden xl:block absolute -bottom-1 right-1 text-[11px] text-black/60 dark:text-icon-fill-color-d">{tool.shortcut}</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isToolDisabled ? `${tool.label} (Disabled in read-only mode)` : tool.label}
                                </TooltipContent>
                            </Tooltip>
                        );
                    })}
                </div>
                <div className="HintViewer sr-only text-[.75rem] text-gray-400 text-center mt-2 w-full max-w-full pointer-events-none absolute flex flex-col justify-center left-0 top-full"><span>To move canvas, hold mouse wheel or spacebar while dragging, or use the hand tool</span></div>
            </header>
        </TooltipProvider>
    )
}