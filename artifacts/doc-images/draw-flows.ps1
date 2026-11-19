Add-Type -AssemblyName System.Drawing
$out = Split-Path -Parent $MyInvocation.MyCommand.Path

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(255, 248, 250, 252))
  return @{ bmp = $bmp; g = $g }
}

function Save-Canvas($c, [string]$name) {
  $c.g.Dispose()
  $c.bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $c.bmp.Dispose()
}

function Draw-Title($g, [string]$text, [int]$w) {
  $font = New-Object System.Drawing.Font "Segoe UI", 22, ([System.Drawing.FontStyle]::Bold)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 27, 58, 95))
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = "Center"
  $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF 20, 18, ($w - 40), 40), $sf)
  $font.Dispose(); $brush.Dispose()
}

function Draw-Box($g, [int]$x, [int]$y, [int]$w, [int]$h, [string]$text, [string]$hex, [int]$size = 13) {
  $r = [Convert]::ToInt32($hex.Substring(0,2),16)
  $gn = [Convert]::ToInt32($hex.Substring(2,2),16)
  $b = [Convert]::ToInt32($hex.Substring(4,2),16)
  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,$r,$gn,$b))
  $g.FillRectangle($fill, $x, $y, $w, $h)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,15,23,42)), 1
  $g.DrawRectangle($pen, $x, $y, $w, $h)
  $font = New-Object System.Drawing.Font "Segoe UI", $size, ([System.Drawing.FontStyle]::Bold)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = "Center"
  $sf.LineAlignment = "Center"
  $rect = New-Object System.Drawing.RectangleF ($x+8), ($y+6), ($w-16), ($h-12)
  $g.DrawString($text, $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $fill.Dispose(); $pen.Dispose(); $font.Dispose()
}

function Draw-Arrow($g, [int]$x1, [int]$y1, [int]$x2, [int]$y2) {
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 37, 99, 235)), 3
  $pen.CustomEndCap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap 6, 7
  $g.DrawLine($pen, $x1, $y1, $x2, $y2)
  $pen.Dispose()
}

function Draw-Note($g, [int]$x, [int]$y, [int]$w, [string]$text) {
  $font = New-Object System.Drawing.Font "Segoe UI", 11
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 71, 85, 105))
  $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF $x, $y, $w, 80))
  $font.Dispose(); $brush.Dispose()
}

# 1 module map
$c = New-Canvas 1500 860
Draw-Title $c.g "BizOne SG — Modules on the sidebar" 1500
$boxes = @(
  @(40,90,220,70,"Dashboard","1B3A5F"),
  @(280,90,280,70,"Payroll`nEmployees · Payroll · IR8A","1D4ED8"),
  @(580,90,300,70,"Fixed Assets`nAdd · Register · Dep · Disposal","0F766E"),
  @(900,90,250,70,"Licenses","334155"),
  @(1170,90,280,70,"Directory`nVendors · Customers","7C3AED")
)
foreach ($b in $boxes) { Draw-Box $c.g $b[0] $b[1] $b[2] $b[3] $b[4] $b[5] 14 }
Draw-Box $c.g 40 220 700 110 "Transactions — General`nPurchases: PQ · PO · Vendor PI · GRN · Vendor Invoice · Debit Note`nSales: Quotation · SO · Proforma · Tax Invoice · DO · Credit Note" "1E40AF" 13
Draw-Box $c.g 760 220 690 110 "Transactions — Man power supply`nVendors: Quotation · PO · Deployment · Timesheet · Vendor Invoice`nCustomers: Quotation · SO · Deployment · Timesheet · Tax Invoice" "B45309" 13
Draw-Box $c.g 40 390 460 90 "Inventory`nWarehouses · Item Master · Transfer · Reports" "0369A1" 14
Draw-Box $c.g 520 390 930 90 "Accounting (Singapore)`nCOA · Journals · GL · Trial Balance · P and L · Balance Sheet · Cash Flow`nIncome · Expenses · GST · AR · AP · Bank Reconciliation" "14532D" 14
Draw-Box $c.g 40 540 700 80 "System`nUsers · Audit Log · Settings · Backup · Year End · Report Design" "334155" 14
Draw-Box $c.g 760 540 690 80 "One posted journal ledger`nEvery money event writes here. Statements only read live posted journals." "7F1D1D" 14
Draw-Arrow $c.g 985 480 1100 540
Draw-Note $c.g 40 650 1400 "Money documents in Transactions, Payroll, Assets, Income and Expenses all write the same journal ledger. Point of Sale, Bill of Materials, Projects, Multiple Price Levels and Batch and Expiry exist in the product but are hidden from the current sidebar."
Save-Canvas $c "01-module-map.png"

# 2 payroll
$c = New-Canvas 1100 1280
Draw-Title $c.g "Payroll workflow into accounting" 1100
Draw-Box $c.g 300 80 500 70 "1. Employees`nMaster data. No journal." "334155" 15
Draw-Arrow $c.g 550 150 550 180
Draw-Box $c.g 300 180 500 80 "2. Payroll config`nBasic, allowances, deductions, CPF, month. No journal." "1D4ED8" 14
Draw-Arrow $c.g 550 260 550 290
Draw-Box $c.g 300 290 500 80 "3. Process payroll`nIndividual or batch for the month" "1E3A8A" 15
Draw-Arrow $c.g 550 370 550 400
Draw-Box $c.g 220 400 660 110 "Journal  ref_type = payroll   PR-{id}`nDR 6000 Gross salary`nDR 6010 Employer CPF`nCR 2050 CPF payable    CR 2040 Net salary payable" "14532D" 14
Draw-Arrow $c.g 550 510 550 545
Draw-Box $c.g 300 545 500 70 "4. Record payment`nSalary and/or CPF as a confirmed Expense" "B45309" 14
Draw-Arrow $c.g 550 615 550 645
Draw-Box $c.g 220 645 660 100 "Journal  ref_type = expense`nSalary: DR 2040  CR 1010 Bank`nCPF:    DR 2050  CR 1010 Bank" "14532D" 14
Draw-Arrow $c.g 550 745 550 780
Draw-Box $c.g 160 780 780 90 "Statements`nP and L keeps the salary cost. Balance Sheet payables fall. Cash falls." "7F1D1D" 15
Draw-Box $c.g 160 920 780 80 "IR8A / AIS and Employer's IR8A`nStatutory filing only. They do not post a journal." "475569" 14
Draw-Note $c.g 80 1040 940 "Payment does not expense the salary again. Process creates the cost. Payment only settles the payable."
Save-Canvas $c "02-payroll-flow.png"

# 3 assets
$c = New-Canvas 1100 1200
Draw-Title $c.g "Fixed asset workflow into accounting" 1100
Draw-Box $c.g 250 80 600 80 "1. Add Asset / Register`nTag, name, category, cost, life, method. No journal yet." "334155" 14
Draw-Arrow $c.g 550 160 550 195
Draw-Box $c.g 250 195 600 70 "2. Asset payment (Expense, confirmed)" "B45309" 15
Draw-Arrow $c.g 550 265 550 295
Draw-Box $c.g 200 295 700 80 "Journal: DR 1500 / 1600 / 1700 Fixed Asset`nCR 1010 Cash at Bank" "14532D" 15
Draw-Arrow $c.g 550 375 550 410
Draw-Box $c.g 250 410 600 70 "3. Depreciation (backfill when assets are listed)" "0F766E" 14
Draw-Arrow $c.g 550 480 550 510
Draw-Box $c.g 200 510 700 80 "Journal: DR 6700 Depreciation`nCR 1510 / 1610 / 1710 Accumulated depreciation" "14532D" 14
Draw-Arrow $c.g 550 590 550 625
Draw-Box $c.g 220 625 660 70 "4. Disposal: sale, scrap, write-off, donation" "7C2D12" 15
Draw-Arrow $c.g 550 695 550 725
Draw-Box $c.g 140 725 820 120 "Journal clears cost and accumulated depreciation.`nCash in if sold. Gain to 4200 or loss to 7200.`nReverse disposal soft-removes this journal." "14532D" 14
Draw-Arrow $c.g 550 845 550 880
Draw-Box $c.g 180 880 740 80 "Balance Sheet fixed-asset drill-down`nShows register cost, amount paid, balance due." "7F1D1D" 14
Save-Canvas $c "03-asset-flow.png"

# 4 general transactions
$c = New-Canvas 1500 780
Draw-Title $c.g "General transactions — what posts to accounts" 1500
Draw-Box $c.g 60 100 300 70 "Purchase Quotation`nNo journal" "64748B" 14
Draw-Arrow $c.g 210 170 210 200
Draw-Box $c.g 60 200 300 70 "Purchase Order`nNo journal" "64748B" 14
Draw-Arrow $c.g 210 270 210 300
Draw-Box $c.g 60 300 300 70 "Vendor Proforma / GRN`nStock movement, not P and L" "0369A1" 13
Draw-Arrow $c.g 210 370 210 400
Draw-Box $c.g 40 400 340 110 "Vendor Invoice confirmed`nDR 5000 or stock or chosen account`nDR 1110 GST input`nCR 2000 Accounts Payable" "14532D" 13
Draw-Box $c.g 1140 100 300 70 "Quotation`nNo journal" "64748B" 14
Draw-Arrow $c.g 1290 170 1290 200
Draw-Box $c.g 1140 200 300 70 "Sales Order`nNo journal" "64748B" 14
Draw-Arrow $c.g 1290 270 1290 300
Draw-Box $c.g 1140 300 300 70 "Proforma / Delivery Order`nNo revenue journal" "0369A1" 13
Draw-Arrow $c.g 1290 370 1290 400
Draw-Box $c.g 1120 400 340 110 "Tax Invoice confirmed`nDR 1100 Accounts Receivable`nCR 4000 Sales Revenue`nCR 2010 GST output" "14532D" 13
Draw-Box $c.g 460 520 580 90 "Then collect or pay`nCustomer receipt: DR Bank CR 1100`nVendor payment: DR 2000 CR Bank" "7F1D1D" 14
Draw-Arrow $c.g 380 455 500 520
Draw-Arrow $c.g 1120 455 980 520
Draw-Note $c.g 60 650 1380 "Credit Note reduces sales. Debit Note adjusts the vendor side. Draft documents do not post."
Save-Canvas $c "04-general-transactions.png"

# 5 manpower
$c = New-Canvas 1500 900
Draw-Title $c.g "Man power supply — vendor side and customer side" 1500
Draw-Box $c.g 80 90 560 50 "VENDORS  (what you pay)" "7C2D12" 16
Draw-Box $c.g 860 90 560 50 "CUSTOMERS  (what you bill)" "1E3A8A" 16
$stepsL = @("Quotation","Purchase order","Employee Deployment","Time Sheet","Vendor Invoice")
$stepsR = @("Quotation","Sales order","Employee Deployment","Time Sheet","Tax Invoice")
for ($i=0; $i -lt 5; $i++) {
  $y = 170 + ($i * 100)
  Draw-Box $c.g 150  $y 420 70 $stepsL[$i] $(if ($i -eq 4) {"14532D"} else {"475569"}) 16
  Draw-Box $c.g 930 $y 420 70 $stepsR[$i] $(if ($i -eq 4) {"14532D"} else {"475569"}) 16
  if ($i -lt 4) {
    Draw-Arrow $c.g 360 ($y+70) 360 ($y+100)
    Draw-Arrow $c.g 1140 ($y+70) 1140 ($y+100)
  }
}
Draw-Note $c.g 40 700 1420 "Only the invoices post journals. Deployment and timesheet are operations. Vendor invoice uses 5010 Cost of Services. Customer tax invoice uses 4000 Sales Revenue."
Save-Canvas $c "05-manpower-flow.png"

# 6 accounting
$c = New-Canvas 1400 860
Draw-Title $c.g "Accounting workflow" 1400
Draw-Box $c.g 500 80 400 60 "Chart of Accounts" "1B3A5F" 16
Draw-Arrow $c.g 700 140 700 175
Draw-Box $c.g 420 175 560 70 "Journal Entries`nmanual or auto-posted from modules" "1D4ED8" 15
Draw-Arrow $c.g 500 245 250 300
Draw-Arrow $c.g 700 245 700 300
Draw-Arrow $c.g 900 245 1150 300
Draw-Box $c.g 40 300 280 70 "Trial Balance" "0F766E" 15
Draw-Box $c.g 360 300 280 70 "General Ledger" "0F766E" 15
Draw-Box $c.g 680 300 280 70 "Profit and Loss" "14532D" 15
Draw-Box $c.g 1000 300 340 70 "Balance Sheet" "14532D" 15
Draw-Arrow $c.g 820 370 820 420
Draw-Box $c.g 520 420 560 70 "Cash Flow`nprofit + depreciation + working capital + investing" "7F1D1D" 13
Draw-Box $c.g 40 560 420 80 "Income and Expenses`nconfirm posts the journal" "B45309" 14
Draw-Box $c.g 490 560 420 80 "GST F5 F7 IO · WHT · ECI · Form C-S · IAF`nread the same books" "334155" 13
Draw-Box $c.g 940 560 400 80 "AR / AP · Aging · Statements`nBank Reconciliation" "1E3A8A" 14
Save-Canvas $c "06-accounting-flow.png"

# 7 end to end
$c = New-Canvas 1500 720
Draw-Title $c.g "From operations to the financial statements" 1500
Draw-Box $c.g 40 140 280 90 "Payroll process`nand salary / CPF payment" "1D4ED8" 14
Draw-Box $c.g 40 280 280 90 "Asset payment`ndepreciation · disposal" "0F766E" 14
Draw-Box $c.g 40 420 280 90 "Manpower and general`ninvoices and payments" "B45309" 14
Draw-Box $c.g 40 560 280 80 "Income · Expenses`nmanual journals" "334155" 14
Draw-Box $c.g 520 280 420 140 "Posted Journal Entry`nref_type + ref_id`nbalanced debit = credit`nstatus = posted" "14532D" 16
Draw-Arrow $c.g 320 185 520 320
Draw-Arrow $c.g 320 325 520 340
Draw-Arrow $c.g 320 465 520 380
Draw-Arrow $c.g 320 600 520 400
Draw-Box $c.g 1100 120 340 70 "Trial Balance" "1B3A5F" 15
Draw-Box $c.g 1100 210 340 70 "Profit and Loss" "1B3A5F" 15
Draw-Box $c.g 1100 300 340 70 "Balance Sheet" "1B3A5F" 15
Draw-Box $c.g 1100 390 340 70 "General Ledger" "1B3A5F" 15
Draw-Box $c.g 1100 480 340 70 "Cash Flow" "1B3A5F" 15
Draw-Arrow $c.g 940 350 1100 155
Draw-Arrow $c.g 940 350 1100 245
Draw-Arrow $c.g 940 350 1100 335
Draw-Arrow $c.g 940 350 1100 425
Draw-Arrow $c.g 940 350 1100 515
Save-Canvas $c "07-e2e-connection.png"
Write-Output "images ok"
