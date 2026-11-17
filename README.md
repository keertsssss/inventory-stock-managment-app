# Srinivasa Enterprises — Stock Register & Inventory System

Automated inventory tracking, physical audit count, and dynamic SKU onboarding system for **Srinivasa Enterprises NOVUM Energy Infra**.

---

## Project Structure

```text
stock-app/
├── server.js                  # Main Express web & API server (Node.js 22+ with node:sqlite)
├── package.json               # Project manifest, dependencies and npm scripts
├── README.md                  # System architecture, commands & documentation
├── .gitignore                 # Excludes node_modules, temp files, and sqlite journals
│
├── data/                      # Data files & master sheets
│   ├── Srinivasa_Stock_Rack_Plan.xlsx # Master Excel file with Stock Master & Rack Plan
│   ├── stock-master.csv       # Formatted 14-column CSV with dynamic formulas
│   └── items.json             # Seed catalog of 335 items
│
├── lib/                       # Backend business logic & engines
│   ├── excel-sync.js          # Excel .xlsx & .csv parser and Tally count sync engine
│   └── sku-generator.js       # SKU pattern detection & sequential code generator
│
├── public/                    # Frontend client assets (served statically)
│   ├── index.html             # Single Page Application layout (Orange themed)
│   ├── app.js                 # Frontend application logic & live API integration
│   └── style.css              # Custom styling, responsive tables & badge design
│
├── scripts/                   # CLI utilities & automation scripts
│   ├── generate-stock-csv.js  # Export stock table to stock-master.csv
│   └── sync-excel.js          # CLI sync to import Tally counts from Excel
│
└── stock.db                   # SQLite primary database (WAL mode, ACID ledger)
```

---

## Quick Start

### 1. Install & Run
```powershell
npm install
npm start
```
*To run with auto-reload during development:*
```powershell
npm run dev
```

### 2. Available Commands
| Command | Description |
|---|---|
| `npm start` | Starts the stock server on port 3000 (`http://localhost:3000`) |
| `npm run dev` | Starts server with Node's native file watcher (`--watch`) |
| `npm run sync-excel` | Synchronizes Tally counts from `data/Srinivasa_Stock_Rack_Plan.xlsx` |
| `npm run export-csv` | Generates 14-column `stock-master.csv` with Excel formulas |

---

## Core Features

1. **Issue / Receive Ledger**:
   - Issue stock with live balance validation (prevents negative stock).
   - Receive incoming inventory with live tally count updates.
   - Clean confirmation notification (`Done, thank you!`) and automatic form reset.

2. **Stock Master Table**:
   - 14-column layout with dynamic serial numbers (`ROW_NUMBER() OVER (...)`).
   - Live Tally Count displaying opening stock plus receipts minus issues.
   - Inline physical count inputs with real-time variance calculation.
   - Orange visual branding (`#ea580c`).

3. **Product Onboarding**:
   - Category pattern detection (e.g., `MOT-001`, `MOT-045` $\rightarrow$ `MOT-046`).
   - In-between sub-variant branch codes (e.g., `MOT-012A`).
   - Dynamic 15–30 day `NEW` product badge and shelf highlights.

4. **Excel / Tally Integration**:
   - 1-click **Sync from Excel** button to take latest Tally quantities from the master Excel sheet.
   - Drag-and-drop / upload picker for custom `.xlsx` or `.csv` sheets.
