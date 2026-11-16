/**
 * Centralized Question Group Metadata Engine
 * Defines question group boundaries based on Class, Scholarship Mode, and Exam Type.
 */

const SUBJECT_MAPPINGS = {
  CM: {
    '6': {
      MAT: [
        { id: 'mat-1', name: 'Relationship', start: 1, end: 6 },
        { id: 'mat-2', name: 'Complete the series', start: 7, end: 12 },
        { id: 'mat-3', name: 'Odd man out', start: 13, end: 18 },
        { id: 'mat-4', name: 'Direction', start: 19, end: 20 },
        { id: 'mat-5', name: 'Coding-decoding', start: 21, end: 24 },
        { id: 'mat-6', name: 'Family relations', start: 25, end: 27 },
        { id: 'mat-7', name: 'Replacing symbols', start: 28, end: 29 },
        { id: 'mat-8', name: 'Age based', start: 30, end: 31 },
        { id: 'mat-9', name: 'Date and Time based', start: 32, end: 34 },
        { id: 'mat-10', name: 'No. series preceded or followed', start: 35, end: 36 },
        { id: 'mat-11', name: 'Sitting position/ Serial order', start: 37, end: 38 },
        { id: 'mat-12', name: 'Number Matrix', start: 39, end: 41 },
        { id: 'mat-13', name: 'Figural Matrix', start: 42, end: 44 },
        { id: 'mat-14', name: 'Passage based', start: 45, end: 48 },
        { id: 'mat-15', name: 'Find the Hidden / Embedded figure', start: 49, end: 51 },
        { id: 'mat-16', name: 'Height/ Weight based', start: 52, end: 53 },
        { id: 'mat-17', name: 'Problem figure and Answer Figure', start: 54, end: 55 },
        { id: 'mat-18', name: 'Mirror/Water image', start: 56, end: 58 },
        { id: 'mat-19', name: 'Word/Sentence Formation', start: 59, end: 60 },
      ],
      SAT: [
        { id: 'sat-1', name: 'Hindi', start: 1, end: 20 },
        { id: 'sat-2', name: 'Environmental studies', start: 21, end: 40 },
        { id: 'sat-3', name: 'Mathematics', start: 41, end: 60 },
      ]
    },
    '9': {
      MAT: [
        { id: 'mat-1', name: 'Relationship', start: 1, end: 8 },
        { id: 'mat-2', name: 'Complete the series', start: 9, end: 16 },
        { id: 'mat-3', name: 'Odd man out', start: 17, end: 24 },
        { id: 'mat-4', name: 'Venn Diagram', start: 25, end: 29 },
        { id: 'mat-5', name: 'Direction based', start: 30, end: 33 },
        { id: 'mat-6', name: 'Coding-decoding', start: 34, end: 38 },
        { id: 'mat-7', name: 'Family relations', start: 39, end: 42 },
        { id: 'mat-8', name: 'Figure Rotation', start: 43, end: 44 },
        { id: 'mat-9', name: 'Mirror Image/ Water image', start: 45, end: 48 },
        { id: 'mat-10', name: 'Replacing symbols', start: 49, end: 51 },
        { id: 'mat-11', name: 'Age based', start: 52, end: 54 },
        { id: 'mat-12', name: 'Date and Time based', start: 55, end: 57 },
        { id: 'mat-13', name: 'No. series preceded or followed', start: 58, end: 60 },
        { id: 'mat-14', name: 'Sitting position/ Serial order', start: 61, end: 63 },
        { id: 'mat-15', name: 'Number Matrix', start: 64, end: 68 },
        { id: 'mat-16', name: 'Figural Matrix', start: 69, end: 73 },
        { id: 'mat-17', name: 'Passage based', start: 74, end: 78 },
        { id: 'mat-18', name: 'Find the Hidden / Embedded figure', start: 79, end: 81 },
        { id: 'mat-19', name: 'Identifying components of a figure', start: 82, end: 84 },
        { id: 'mat-20', name: 'Paper folding', start: 85, end: 86 },
        { id: 'mat-21', name: 'Statement & Conclusion', start: 87, end: 88 },
        { id: 'mat-22', name: 'Cube/ Dice based', start: 89, end: 90 },
        { id: 'mat-23', name: 'Composition Based', start: 91, end: 93 },
        { id: 'mat-24', name: 'Problem figure & Answer figure', start: 94, end: 98 },
        { id: 'mat-25', name: 'Count the figure', start: 99, end: 100 },
      ],
      SAT: [
        { id: 'sat-1', name: 'Social Science', start: 1, end: 40 },
        { id: 'sat-2', name: 'Science', start: 41, end: 80 },
        { id: 'sat-3', name: 'Mathematics', start: 81, end: 100 },
      ]
    }
  },
  NMMSS: {
    '8': {
      MAT: [
        { id: 'mat-1', name: 'Relationship', start: 1, end: 6 },
        { id: 'mat-2', name: 'Complete the series', start: 7, end: 12 },
        { id: 'mat-3', name: 'Odd man out', start: 13, end: 18 },
        { id: 'mat-4', name: 'Venn Diagram', start: 19, end: 23 },
        { id: 'mat-5', name: 'Direction', start: 24, end: 27 },
        { id: 'mat-6', name: 'Coding-decoding', start: 28, end: 31 },
        { id: 'mat-7', name: 'Family relations', start: 32, end: 34 },
        { id: 'mat-8', name: 'Replacing symbols', start: 35, end: 37 },
        { id: 'mat-9', name: 'Age based', start: 38, end: 40 },
        { id: 'mat-10', name: 'Date and Time based', start: 41, end: 43 },
        { id: 'mat-11', name: 'No. series preceded or followed', start: 44, end: 48 },
        { id: 'mat-12', name: 'Sitting position/ Serial order', start: 49, end: 51 },
        { id: 'mat-13', name: 'Number Matrix', start: 52, end: 56 },
        { id: 'mat-14', name: 'Figural Matrix', start: 57, end: 61 },
        { id: 'mat-15', name: 'Passage based', start: 62, end: 66 },
        { id: 'mat-16', name: 'Find the Hidden / Embedded figure', start: 67, end: 69 },
        { id: 'mat-17', name: 'Identifying components of a figure', start: 70, end: 72 },
        { id: 'mat-18', name: 'Height /Weight based', start: 73, end: 74 },
        { id: 'mat-19', name: 'Problem figure and Answer Figure', start: 75, end: 79 },
        { id: 'mat-20', name: 'Mirror/Water image', start: 80, end: 82 },
        { id: 'mat-21', name: 'Word Formation/ Dictionary Based', start: 83, end: 86 },
        { id: 'mat-22', name: 'Count the figure', start: 87, end: 87 },
        { id: 'mat-23', name: 'Dice/Cube based', start: 88, end: 89 },
        { id: 'mat-24', name: 'Statement/Reason based', start: 90, end: 90 },
      ],
      SAT: [
        { id: 'sat-1', name: 'Social Science', start: 1, end: 36 },
        { id: 'sat-2', name: 'Science', start: 37, end: 72 },
        { id: 'sat-3', name: 'Mathematics', start: 73, end: 90 },
      ]
    }
  }
};

/**
 * Normalizes scholarship mode to internal keys ('CM', 'NMMSS')
 */
function getScholarshipMode(scholarshipId, scholarshipName) {
  const id = Number(scholarshipId);
  const name = String(scholarshipName || '').toLowerCase();

  if (id === 3 || id === 7 || /\bcm\b/i.test(name) || name.includes('chief minister')) {
    return 'CM';
  }

  if (id === 6 || name.includes('nmmss') || name.includes('nmms') || name.includes('snss') || name.includes('ssss')) {
    return 'NMMSS';
  }

  return 'GENERIC';
}

/**
 * Gets question groups for a specific filter.
 */
function getQuestionGroups(scholarshipId, scholarshipName, classValue, examType) {
  const mode = getScholarshipMode(scholarshipId, scholarshipName);
  
  if (!SUBJECT_MAPPINGS[mode]) return [];
  if (!SUBJECT_MAPPINGS[mode][String(classValue)]) return [];
  
  const groups = SUBJECT_MAPPINGS[mode][String(classValue)][String(examType).toUpperCase()];
  return groups || [];
}

module.exports = {
  SUBJECT_MAPPINGS,
  getScholarshipMode,
  getQuestionGroups
};
