'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { RoomParticipants } from "@repo/common/types";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { getClientColor } from "@/utils/getClientColor";

export default function CollaborationToolbar({ participants }: { participants?: RoomParticipants[] }) {
    const displayParticipants = participants?.slice(0, 3);
    const remainingParticipants = participants?.slice(3);

    return (
        <div className="Start_Room_Session transition-transform duration-500 ease-in-out flex items-center justify-end gap-1 md:gap-2">
            <div className="UserList__wrapper flex w-full justify-end items-center">
                <div className="UserList p-1 flex flex-wrap justify-end  items-center">
                    <TooltipProvider delayDuration={0}>
                        <div className="flex gap-1 md:gap-[.625rem]">
                            {displayParticipants?.map((participant) => (
                                <Tooltip key={participant.userId}>
                                    <TooltipTrigger asChild>
                                        <div style={{ backgroundColor: getClientColor(participant) }} className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer`}>
                                            <span className="text-sm font-bold text-gray-900 dark:text-gray-900">
                                                {participant.userName.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {participant.userName}
                                    </TooltipContent>
                                </Tooltip>
                            ))}

                            {remainingParticipants && remainingParticipants.length > 0 && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <div
                                            className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center 
                               cursor-pointer hover:bg-gray-400 transition-colors"
                                        >
                                            <span className="text-xs font-bold text-gray-900">
                                                +{remainingParticipants?.length}
                                            </span>
                                        </div>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-full max-h-[200px] h-full overflow-auto p-4 mt-3 rounded-lg">
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-medium font-assistant">Additional Participants</h4>
                                            {remainingParticipants?.map((participant) => (
                                                <div
                                                    key={participant.userId}
                                                    className="cursor-pointer select-none flex items-center space-x-2 h-8 w-full justify-start gap-2 rounded-md px-3 text-sm font-medium transition-colors text-color-on-surface hover:text-color-on-surface bg-transparent hover:bg-button-hover-bg focus-visible:shadow-brand-color-shadow focus-visible:outline-none focus-visible:ring-0 active:bg-button-hover-bg active:border active:border-brand-active dark:hover:bg-w-button-hover-bg"
                                                >
                                                    <div style={{ backgroundColor: getClientColor(participant) }} className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer`}>
                                                        <span className="text-sm font-bold text-gray-900 dark:text-gray-900">
                                                            {participant.userName.charAt(0).toUpperCase()}
                                                        </span>
                                                    </div>

                                                    <span className="text-sm text-color-on-surface">{participant.userName}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
                        </div>
                    </TooltipProvider>
                </div>
            </div>
        </div>
    )
}