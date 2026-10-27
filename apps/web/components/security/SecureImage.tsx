'use client'

import Image from "next/image"
import type { ImageProps } from "next/image"
import type { FC } from "react"

/**
 * Drop-in secure image wrapper that blocks context menu and drag start,
 * and prevents selection.
 */
export const SecureImage: FC<ImageProps> = ({ alt, onContextMenu, onDragStart, style, ...rest }) => {
  const handleContextMenu = (event: React.MouseEvent<HTMLImageElement>) => {
    event.preventDefault()
    if (onContextMenu) {
      onContextMenu(event)
    }
  }

  const handleDragStart = (event: React.DragEvent<HTMLImageElement>) => {
    event.preventDefault()
    if (onDragStart) {
      onDragStart(event)
    }
  }

  const combinedStyle = {
    userSelect: "none" as const,
    ...(style || {}),
  }

  return (
    <Image
      alt={alt || ""}
      decoding="async"
      loading="lazy"
      priority={false}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      style={combinedStyle}
      {...rest}
    />
  )
}