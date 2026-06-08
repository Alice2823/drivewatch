/**
 * pdfReportGenerator.ts — Professional PDF Report Generation
 * 
 * Generates high-fidelity, enterprise-grade storage diagnostic reports.
 * Uses PDFKit for precision layout and professional aesthetics.
 */

import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { StorageDiagnosticReport } from './storageDiagnostics'
import type { DiskData } from './diskService'

// ── Colors ──────────────────────────────────────────────────────────────────
const COLORS = {
  bg: '#0f172a',      // Slate 900 (Header/Dark cards)
  text: '#1e293b',    // Slate 800 (Body text)
  textMuted: '#64748b', // Slate 500
  primary: '#0ea5e9', // Sky 500
  success: '#10b981', // Emerald 500
  warning: '#f59e0b', // Amber 500
  error: '#ef4444',   // Red 500
  white: '#ffffff',
  border: '#e2e8f0',  // Slate 200
  cardBg: '#f8fafc'   // Slate 50
}

export async function generatePdfReport(
  report: StorageDiagnosticReport,
  disks: DiskData[],
  filePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0, // CRITICAL: Disable auto-margins to prevent accidental page breaks
        autoFirstPage: true
      })

      const stream = fs.createWriteStream(filePath)
      doc.pipe(stream)

      const fontBold = 'Helvetica-Bold'
      const fontRegular = 'Helvetica'

      // Helper for Footer (drawn at 810y, safe from breaks with 0 margin)
      const drawFooter = () => {
        doc.rect(0, 812, doc.page.width, 30).fill(COLORS.cardBg)
        doc.fillColor(COLORS.textMuted).fontSize(7).font(fontRegular)
           .text('DriveWatch Storage Intelligence • Professional Diagnostic Report', 40, 825)
        doc.fillColor(COLORS.text)
      }

      // ── Header (Page 1) ───────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 140).fill(COLORS.bg)
      
      const logoPath = path.join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'logo.png')
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 35, { width: 40 })
      }

      doc.fillColor(COLORS.white).fontSize(24).font(fontBold).text('DriveWatch', 90, 40)
      doc.fontSize(10).font(fontRegular).fillColor(COLORS.primary).text('ENTERPRISE STORAGE DIAGNOSTICS', 90, 68)

      doc.fillColor(COLORS.white).fontSize(8)
         .text(`Report ID: DW-${Date.now().toString(36).toUpperCase()}`, 450, 40, { align: 'right', width: 100 })
         .text(`Version: ${app.getVersion()}`, 450, 52, { align: 'right', width: 100 })
         .text(`Generated: ${new Date().toLocaleString()}`, 450, 64, { align: 'right', width: 100 })

      drawFooter()

      // ── Summary Section ───────────────────────────────────────────────────
      let y = 160
      doc.fillColor(COLORS.text).fontSize(16).font(fontBold).text('System Health Summary', 40, y)
      y += 25
      
      const scoreColor = report.overallStatus === 'healthy' ? COLORS.success : 
                         report.overallStatus === 'warning' ? COLORS.warning : COLORS.error
      
      doc.rect(40, y, 160, 80).fill(COLORS.cardBg)
      doc.rect(40, y, 4, 80).fill(scoreColor)
      doc.fillColor(COLORS.textMuted).fontSize(8).font(fontBold).text('HEALTH SCORE', 55, y + 15)
      doc.fillColor(COLORS.text).fontSize(28).text(`${report.overallScore}`, 55, y + 30)
      doc.fontSize(10).fillColor(COLORS.textMuted).text('/ 100', 105, y + 45)

      doc.rect(210, y, 160, 80).fill(COLORS.cardBg)
      doc.rect(210, y, 4, 80).fill(scoreColor)
      doc.fillColor(COLORS.textMuted).fontSize(8).text('SYSTEM STATUS', 225, y + 15)
      doc.fillColor(scoreColor).fontSize(14).text(report.overallStatus.toUpperCase(), 225, y + 35)

      doc.rect(380, y, 175, 80).fill(COLORS.cardBg)
      doc.rect(380, y, 4, 80).fill(COLORS.primary)
      doc.fillColor(COLORS.textMuted).fontSize(8).text('DETECTION STATS', 395, y + 15)
      doc.fillColor(COLORS.text).fontSize(10)
         .text(`Drives Detected: ${disks.length}`, 395, y + 35)
         .text(`Scan Duration: ${report.scanDurationMs}ms`, 395, y + 50)

      y += 105

      // ── Devices Section ───────────────────────────────────────────────────
      doc.fillColor(COLORS.text).fontSize(14).font(fontBold).text('Storage Device Details', 40, y)
      y += 20

      for (const disk of disks) {
        if (y > 750) { doc.addPage(); drawFooter(); y = 40 }

        doc.rect(40, y, 515, 110).strokeColor(COLORS.border).lineWidth(1).stroke()
        doc.rect(40, y, 515, 25).fill(COLORS.cardBg)
        doc.fillColor(COLORS.text).fontSize(10).font(fontBold).text(disk.name, 50, y + 8)
        
        const healthColor = disk.health === 'Good' ? COLORS.success : COLORS.error
        doc.fillColor(healthColor).text(disk.health.toUpperCase(), 480, y + 8, { width: 60, align: 'right' })

        y += 35
        doc.fillColor(COLORS.textMuted).fontSize(8).font(fontRegular)
        doc.text('SERIAL NUMBER', 50, y); doc.text('FIRMWARE', 180, y); doc.text('INTERFACE', 300, y); doc.text('CAPACITY', 420, y)
        
        doc.fillColor(COLORS.text).fontSize(9).font(fontBold)
        doc.text(disk.serial || 'N/A', 50, y + 12); doc.text(disk.firmware || 'N/A', 180, y + 12); doc.text(disk.type, 300, y + 12); doc.text(`${(disk.size / (1024 ** 3)).toFixed(2)} GB`, 420, y + 12)

        y += 35
        doc.fillColor(COLORS.textMuted).fontSize(8).font(fontRegular)
        doc.text('TEMPERATURE', 50, y); doc.text('SMART STATUS', 180, y); doc.text('TRIM STATUS', 300, y)
        
        const trimInfo = report.trimStatus.find(t => t.diskIndex === disk.diskIndex)
        const trimText = trimInfo ? (trimInfo.trimEnabled ? 'ENABLED' : 'DISABLED') : 'N/A'

        doc.fillColor(COLORS.text).fontSize(9).font(fontBold)
        doc.text(disk.temperature !== null ? `${disk.temperature}°C` : 'N/A', 50, y + 12)
        doc.text(disk.health === 'Good' ? 'OPTIMAL' : 'WARNING', 180, y + 12)
        doc.text(trimText, 300, y + 12)

        y += 120 
      }

      // ── Recommendations Section ───────────────────────────────────────────
      if (report.recommendations.length > 0) {
        if (y > 650) { doc.addPage(); drawFooter(); y = 40 } else { y += 10 }
        
        doc.fillColor(COLORS.text).fontSize(14).font(fontBold).text('Actionable Recommendations', 40, y)
        y += 20

        for (const rec of report.recommendations) {
          if (y > 780) { doc.addPage(); drawFooter(); y = 40 }
          const recColor = rec.severity === 'critical' ? COLORS.error : rec.severity === 'high' ? COLORS.warning : rec.severity === 'medium' ? COLORS.warning : COLORS.primary
          doc.rect(40, y, 4, 30).fill(recColor)
          doc.fillColor(COLORS.text).fontSize(9).font(fontBold).text(rec.title, 55, y)
          doc.fillColor(COLORS.textMuted).fontSize(8).font(fontRegular).text(rec.description, 55, y + 12, { width: 480 })
          y += 40
        }
      }

      // ── Performance & Controller Info ─────────────────────────────────────
      if (report.controllers.length > 0) {
        if (y > 720) { doc.addPage(); drawFooter(); y = 40 } else { y += 15 }
        doc.fillColor(COLORS.text).fontSize(14).font(fontBold).text('Controller & Interface Performance', 40, y)
        y += 20

        for (const ctrl of report.controllers) {
          if (y > 780) { doc.addPage(); drawFooter(); y = 40 }
          doc.fillColor(COLORS.textMuted).fontSize(8).text(ctrl.model.toUpperCase(), 40, y)
          y += 10
          doc.fillColor(COLORS.text).fontSize(9).text(`${ctrl.controllerName} • ${ctrl.interfaceType}`, 40, y)
          if (ctrl.pcieGeneration) {
            doc.text(`PCIe Info: ${ctrl.pcieGeneration} x${ctrl.pcieLinkWidth || '?'}`, 40, y + 12)
            y += 12
          }
          y += 30
        }
      }

      doc.end()
      stream.on('finish', () => resolve())
      stream.on('error', (err) => reject(err))
    } catch (err) { reject(err) }
  })
}
