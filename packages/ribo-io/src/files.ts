/** Browser file helpers: offering a download and picking a file. */

export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0])
    input.oncancel = () => resolve(undefined)
    input.click()
  })
}

/** A design name as a safe file name stem */
export function fileStem(name: string | undefined): string {
  const stem = (name ?? '').trim().replace(/[^\w\-äöüÄÖÜß ]+/g, '').replace(/\s+/g, '_')
  return stem || 'design'
}
