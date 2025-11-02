import JSZip from 'jszip'

interface SpecificationData {
  featureName: string
  requirements: string
  design: string
  tasks: string
  modelName?: string
  timing?: {
    requirements?: { elapsed: number }
    design?: { elapsed: number }
    tasks?: { elapsed: number }
  }
  tokens?: {
    requirements?: number
    design?: number
    tasks?: number
  }
}

/**
 * Extract a meaningful project name from the AI-generated tasks content
 * Looks for project titles, feature names, and other identifying patterns
 */
function extractProjectNameFromTasks(tasks: string, fallbackFeatureName: string): string {
  if (!tasks) return fallbackFeatureName
  
  // Common patterns to look for in task content
  const patterns = [
    // Look for "# Project Name" or "## Project Name" at the beginning
    /^#{1,2}\s*(.+?)$/m,
    // Look for "Project:" or "Feature:" labels
    /(?:Project|Feature):\s*(.+?)(?:\n|$)/i,
    // Look for "Implementation Task List:" followed by a name
    /Implementation Task List:\s*(.+?)(?:\n|$)/i,
    // Look for common project structure indicators
    /(?:Building|Creating|Developing|Implementing)\s+(?:a|an|the)?\s*(.+?)(?:\s+(?:application|app|system|platform|tool|component))?(?:\n|\.|,|$)/i,
    // Look for task descriptions that start with action verbs
    /^\s*\d+\.?\s*\[?[\s\-\*]*\]?\s*(?:Build|Create|Develop|Implement|Set up)\s+(.+?)(?:\s+for|\s+with|\s+using|\n|\.|$)/im
  ]
  
  for (const pattern of patterns) {
    const match = tasks.match(pattern)
    if (match && match[1]) {
      let projectName = match[1].trim()
      // Clean up the extracted name
      projectName = projectName
        .replace(/[\*\#\[\]\(\)]+/g, '') // Remove markdown formatting
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/^(a|an|the)\s+/i, '') // Remove articles
        .trim()
      
      if (projectName.length > 5 && projectName.length < 80) {
        return projectName
      }
    }
  }
  
  // If no good match found, try to extract from feature name or fallback
  return fallbackFeatureName || 'Technical Specification'
}

/**
 * Extract Mermaid diagram code blocks from markdown content with proper naming
 */
function extractMermaidDiagrams(content: string): { name: string; content: string }[] {
  const mermaidRegex = /```mermaid\n([\s\S]*?)\n```/g
  const diagrams: { name: string; content: string }[] = []
  let match
  
  while ((match = mermaidRegex.exec(content)) !== null) {
    const diagramContent = match[1].trim()
    let diagramName = 'diagram'
    
    // Determine diagram type based on content
    if (diagramContent.includes('graph') || diagramContent.includes('flowchart')) {
      if (diagramContent.includes('user') || diagramContent.includes('User')) {
        diagramName = 'user-flow'
      } else if (diagramContent.includes('admin') || diagramContent.includes('Admin')) {
        diagramName = 'admin-flow'
      } else if (diagramContent.includes('system') || diagramContent.includes('System')) {
        diagramName = 'system-flow'
      } else if (diagramContent.includes('data') || diagramContent.includes('Data')) {
        diagramName = 'data-flow'
      } else if (diagramContent.includes('sequence') || diagramContent.includes('Sequence')) {
        diagramName = 'sequence-diagram'
      } else if (diagramContent.includes('class') || diagramContent.includes('Class')) {
        diagramName = 'class-diagram'
      } else if (diagramContent.includes('component') || diagramContent.includes('Component')) {
        diagramName = 'component-diagram'
      } else {
        diagramName = 'flowchart'
      }
    } else if (diagramContent.includes('erDiagram') || diagramContent.includes('ER')) {
      diagramName = 'entity-relationship'
    } else if (diagramContent.includes('gantt') || diagramContent.includes('Gantt')) {
      diagramName = 'gantt-chart'
    } else if (diagramContent.includes('journey') || diagramContent.includes('Journey')) {
      diagramName = 'user-journey'
    } else if (diagramContent.includes('pie') || diagramContent.includes('Pie')) {
      diagramName = 'pie-chart'
    } else if (diagramContent.includes('git') || diagramContent.includes('Git')) {
      diagramName = 'git-graph'
    }
    
    // If we have multiple diagrams of the same type, add a suffix
    const existingCount = diagrams.filter(d => d.name.startsWith(diagramName)).length
    if (existingCount > 0) {
      diagramName = `${diagramName}-${existingCount + 1}`
    }
    
    diagrams.push({ name: diagramName, content: diagramContent })
  }
  
  return diagrams
}

/**
 * Create a comprehensive ZIP file with all specification documents
 */
export async function createSpecificationZip(data: SpecificationData): Promise<Blob> {
  const zip = new JSZip()
  
  // Create main specification files
  if (data.requirements) {
    zip.file('requirements.md', data.requirements)
  }
  
  if (data.design) {
    zip.file('design.md', data.design)
    
    // Extract and save Mermaid diagrams from design phase with proper naming
    const mermaidDiagrams = extractMermaidDiagrams(data.design)
    if (mermaidDiagrams.length > 0) {
      mermaidDiagrams.forEach((diagram) => {
        zip.file(`${diagram.name}.mermaid`, diagram.content)
      })
    }
  }
  
  if (data.tasks) {
    zip.file('tasks.md', data.tasks)
  }
  
  // Create a summary/metadata file
  const metadata = {
    feature_name: data.featureName || 'Technical Specification',
    generated_at: new Date().toISOString(),
    model_used: data.modelName || 'Unknown',
    generation_time: data.timing ? {
      requirements_seconds: data.timing.requirements ? Math.round(data.timing.requirements.elapsed / 1000) : 0,
      design_seconds: data.timing.design ? Math.round(data.timing.design.elapsed / 1000) : 0,
      tasks_seconds: data.timing.tasks ? Math.round(data.timing.tasks.elapsed / 1000) : 0,
      total_seconds: Object.values(data.timing || {}).reduce((total, phase) => total + (phase?.elapsed || 0), 0) / 1000
    } : null,
    token_usage: data.tokens ? {
      requirements_tokens: data.tokens.requirements || 0,
      design_tokens: data.tokens.design || 0,
      tasks_tokens: data.tokens.tasks || 0,
      total_tokens: Object.values(data.tokens || {}).reduce((total, count) => total + (count || 0), 0)
    } : null
  }
  
  zip.file('metadata.json', JSON.stringify(metadata, null, 2))
  
  // Create a README file explaining the package contents
  const readmeContent = `# ${data.featureName || 'Technical Specification'}

Generated by OpenSpec on ${new Date().toLocaleDateString()}

## Package Contents

- **requirements.md** - Functional requirements and user stories
- **design.md** - Technical design and architecture
- **tasks.md** - Implementation tasks breakdown
- **{diagram-name}.mermaid** - Diagram files with descriptive names (e.g., user-flow.mermaid, system-architecture.mermaid)
- **metadata.json** - Generation metadata and statistics

## Usage

1. Review the requirements.md for project scope and user needs
2. Study design.md for technical architecture and implementation approach  
3. Use tasks.md to plan development work and track progress
4. Import .mermaid files into Mermaid-compatible tools for diagram visualization

Generated with ${data.modelName || 'AI assistance'} | OpenSpec v1.0
`
  
  zip.file('README.md', readmeContent)
  
  // Generate and return the ZIP blob
  return zip.generateAsync({ type: 'blob' })
}

/**
 * Download the ZIP file with a user-friendly filename
 */
export function downloadZipFile(blob: Blob, featureName: string = 'specification', tasksContent?: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  
  // Extract project name from tasks content if available
  const projectName = tasksContent ? extractProjectNameFromTasks(tasksContent, featureName) : featureName
  
  // Create a clean filename from the project name
  const cleanName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) // Limit length
  
  const timestamp = new Date().toISOString().split('T')[0] // YYYY-MM-DD format
  a.download = `${cleanName}-spec-${timestamp}.zip`
  
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default {
  createSpecificationZip,
  downloadZipFile
}