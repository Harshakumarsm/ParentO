const express = require('express');
const router = express.Router();
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth');
const Teacher = require('../models/Teacher');
const Parent = require('../models/Parent');
const Announcement = require('../models/Announcement');
const Activity = require('../models/Activity');
const Attendance = require('../models/Attendance');
const Marks = require('../models/Marks');
const Feedback = require('../models/Feedback');

// Create a new classroom (Teacher only)
router.post('/teacher/classroom', auth, async (req, res) => {
  try {
    const { name } = req.body;
    const teacherId = req.user.id;

    // Check if teacher already has a classroom
    const existingClassroom = await Classroom.findOne({ teacher: teacherId });
    if (existingClassroom) {
      return res.status(400).json({ message: 'You can only create one classroom' });
    }

    // Get teacher details
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Validate classroom name
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: 'Classroom name is required' });
    }

    // Generate a unique class code
    let classCode = '';
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 5) {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      classCode = '';
      for (let i = 0; i < 6; i++) {
        classCode += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      
      const existingClassroomWithCode = await Classroom.findOne({ classCode });
      if (!existingClassroomWithCode) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ message: 'Unable to generate unique class code. Please try again.' });
    }

    // Create new classroom
    const classroom = new Classroom({
      name: name.trim(),
      classCode,
      teacher: teacherId,
      teacherName: teacher.name,
      students: []
    });

    // Save to database
    await classroom.save();
    
    // Return the created classroom
    res.status(201).json({
      _id: classroom._id,
      name: classroom.name,
      classCode: classroom.classCode,
      teacher: req.user.id,
      teacherName: teacher.name,
      students: []
    });

  } catch (error) {
    console.error('Error creating classroom:', error);
    res.status(500).json({ message: 'Server error while creating classroom' });
  }
});

// Get teacher's classrooms
router.get('/teacher/classrooms', auth, async (req, res) => {
  try {
    const classrooms = await Classroom.find({ teacher: req.user.id })
      .sort({ createdAt: -1 });
    res.json(classrooms);
  } catch (error) {
    console.error('Error fetching classrooms:', error);
    res.status(500).json({ message: 'Server error while fetching classrooms' });
  }
});

// Join classroom (Parent only)
router.post('/parent/join-classroom', auth, async (req, res) => {
  try {
    const { classCode, studentName, parentName, mobileNumber } = req.body;
    const parentId = req.user.id;

    if (!classCode || !studentName || !parentName || !mobileNumber) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const classroom = await Classroom.findOne({ classCode: classCode.trim() });
    if (!classroom) {
      return res.status(404).json({ message: 'Classroom not found' });
    }

    const existingStudent = classroom.students.find(
      student => student.parent.toString() === parentId
    );
    if (existingStudent) {
      return res.status(400).json({ message: 'Already joined this classroom' });
    }

    classroom.students.push({
      studentName: studentName.trim(),
      parentName: parentName.trim(),
      parent: parentId,
      mobileNumber: mobileNumber.trim(),
      joinedAt: new Date()
    });

    await classroom.save();
    res.json(classroom);
  } catch (error) {
    console.error('Error joining classroom:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get parent's classrooms
router.get('/parent/classrooms', auth, async (req, res) => {
  try {
    const parentId = req.user.id;
    const classrooms = await Classroom.find({ 'students.parent': parentId })
      .populate('teacher', 'name email') // Populate teacher details including email
      .sort({ createdAt: -1 });
    res.json(classrooms);
  } catch (error) {
    console.error('Error fetching classrooms:', error);
    res.status(500).json({ message: 'Server error while fetching classrooms' });
  }
});

// Add this new route for exiting classroom
router.post('/parent/exit-classroom', auth, async (req, res) => {
  try {
    const parentId = req.user.id;
    
    // Find classroom where this parent is enrolled
    const classroom = await Classroom.findOne({ 'students.parent': parentId });
    if (!classroom) {
      return res.status(404).json({ message: 'No classroom found for this parent' });
    }

    // Remove the student entry for this parent
    classroom.students = classroom.students.filter(
      student => student.parent.toString() !== parentId
    );

    await classroom.save();
    res.json({ message: 'Successfully exited classroom' });
  } catch (error) {
    console.error('Error exiting classroom:', error);
    res.status(500).json({ message: 'Server error while exiting classroom' });
  }
});

// Update the delete classroom route
router.delete('/teacher/classroom/:id', auth, async (req, res) => {
  try {
    const classroomId = req.params.id;
    const teacherId = req.user.id;

    // Find and verify classroom belongs to teacher
    const classroom = await Classroom.findOne({ _id: classroomId, teacher: teacherId });
    if (!classroom) {
      return res.status(404).json({ message: 'Classroom not found or unauthorized' });
    }

    // Delete all announcements for this classroom
    await Announcement.deleteMany({ classCode: classroom.classCode });
    
    // Delete all activities for this classroom
    await Activity.deleteMany({ classCode: classroom.classCode });

    // Delete the classroom
    await Classroom.findByIdAndDelete(classroomId);

    // Emit classroom deletion event
    req.app.get('io').emit('classroom_deleted', classroom.classCode);

    res.json({ message: 'Classroom deleted successfully' });
  } catch (error) {
    console.error('Error deleting classroom:', error);
    res.status(500).json({ message: 'Server error while deleting classroom' });
  }
});

// Add this new route for fetching student-parent data
router.get('/teacher/students/:classCode', auth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const classroom = await Classroom.findOne({ classCode });
    
    if (!classroom) {
      return res.status(404).json({ message: 'Classroom not found' });
    }

    // Check if the requesting teacher owns this classroom
    if (classroom.teacher.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to access this classroom' });
    }

    // Return the students array from the classroom
    res.json(classroom.students);
  } catch (error) {
    console.error('Error fetching student-parent data:', error);
    res.status(500).json({ message: 'Server error while fetching student data' });
  }
});

// Update the attendance status route
router.get('/teacher/attendance/:classCode', auth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      classCode,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    res.json({ 
      attendanceSubmitted: !!attendance,
      date: today,
      attendance: attendance || null
    });
  } catch (error) {
    console.error('Error checking attendance status:', error);
    res.status(500).json({ message: 'Server error while checking attendance' });
  }
});

// Update the submit attendance route
router.post('/teacher/attendance/:classCode', auth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const { attendance: attendanceData } = req.body;
    const teacherId = req.user.id;

    const classroom = await Classroom.findOne({ classCode });
    if (!classroom) {
      return res.status(404).json({ message: 'Classroom not found' });
    }

    if (classroom.teacher.toString() !== teacherId) {
      return res.status(403).json({ message: 'Not authorized to submit attendance for this classroom' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if attendance already exists for today
    let attendance = await Attendance.findOne({
      classCode,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    });

    if (attendance) {
      return res.status(400).json({ message: 'Attendance already submitted for today' });
    }

    // Create attendance records
    const attendanceRecords = classroom.students.map(student => ({
      studentId: student._id,
      present: !!attendanceData[student._id],
      studentName: student.studentName,
      parentName: student.parentName
    }));

    attendance = new Attendance({
      classCode,
      date: today,
      teacher: teacherId,
      attendance: attendanceRecords
    });

    await attendance.save();

    res.json({ 
      message: 'Attendance submitted successfully',
      attendance
    });
  } catch (error) {
    console.error('Error submitting attendance:', error);
    res.status(500).json({ message: 'Server error while submitting attendance' });
  }
});

// Add route for adding marks
router.post('/teacher/marks/:classCode/:studentId', auth, async (req, res) => {
  try {
    const { classCode, studentId } = req.params;
    const { subject, marks, totalMarks } = req.body;
    const teacherId = req.user.id;

    // Validate input
    if (!subject || !marks || !totalMarks) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if classroom exists and teacher has access
    const classroom = await Classroom.findOne({ 
      classCode,
      teacher: teacherId,
      'students._id': studentId 
    });

    if (!classroom) {
      return res.status(404).json({ message: 'Classroom or student not found' });
    }

    // Create new marks entry
    const marksEntry = new Marks({
      classCode,
      studentId,
      subject,
      marks: Number(marks),
      totalMarks: Number(totalMarks),
      teacher: teacherId
    });

    await marksEntry.save();

    // Emit socket event for real-time updates
    req.app.get('io').to(classCode).emit('marks_added', {
      studentId,
      marksEntry
    });

    res.json(marksEntry);
  } catch (error) {
    console.error('Error adding marks:', error);
    res.status(500).json({ message: 'Server error while adding marks' });
  }
});

// Add route for getting student marks
router.get('/teacher/marks/:classCode/:studentId', auth, async (req, res) => {
  try {
    const { classCode, studentId } = req.params;
    const teacherId = req.user.id;

    // Verify access
    const classroom = await Classroom.findOne({ 
      classCode,
      teacher: teacherId,
      'students._id': studentId 
    });

    if (!classroom) {
      return res.status(404).json({ message: 'Classroom or student not found' });
    }

    // Get all marks for the student
    const marks = await Marks.find({ classCode, studentId })
      .sort({ date: -1 });

    res.json(marks);
  } catch (error) {
    console.error('Error fetching marks:', error);
    res.status(500).json({ message: 'Server error while fetching marks' });
  }
});

// Add route for adding feedback
router.post('/teacher/feedback/:classCode/:studentId', auth, async (req, res) => {
  try {
    const { classCode, studentId } = req.params;
    const { type, description } = req.body;
    const teacherId = req.user.id;

    // Validate input
    if (!type || !description) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if classroom exists and teacher has access
    const classroom = await Classroom.findOne({ 
      classCode,
      teacher: teacherId,
      'students._id': studentId 
    });

    if (!classroom) {
      return res.status(404).json({ message: 'Classroom or student not found' });
    }

    // Create new feedback entry
    const feedbackEntry = new Feedback({
      classCode,
      studentId,
      type,
      description,
      teacher: teacherId
    });

    await feedbackEntry.save();

    // Emit socket event for real-time updates
    req.app.get('io').to(classCode).emit('feedback_added', {
      studentId,
      feedbackEntry
    });

    res.json(feedbackEntry);
  } catch (error) {
    console.error('Error adding feedback:', error);
    res.status(500).json({ message: 'Server error while adding feedback' });
  }
});

// Add route for getting student feedback
router.get('/teacher/feedback/:classCode/:studentId', auth, async (req, res) => {
  try {
    const { classCode, studentId } = req.params;
    const teacherId = req.user.id;

    // Verify access
    const classroom = await Classroom.findOne({ 
      classCode,
      teacher: teacherId,
      'students._id': studentId 
    });

    if (!classroom) {
      return res.status(404).json({ message: 'Classroom or student not found' });
    }

    // Get all feedback for the student
    const feedback = await Feedback.find({ classCode, studentId })
      .sort({ date: -1 });

    res.json(feedback);
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ message: 'Server error while fetching feedback' });
  }
});

// Add route for parents to get their child's marks
router.get('/parent/marks/:classCode', auth, async (req, res) => {
  try {
    const parentId = req.user.id;
    const { classCode } = req.params;

    // Find the classroom and verify parent's child is enrolled
    const classroom = await Classroom.findOne({
      classCode,
      'students.parent': parentId
    });

    if (!classroom) {
      return res.status(404).json({ message: 'Classroom not found or not enrolled' });
    }

    // Get the student ID from the classroom
    const student = classroom.students.find(s => s.parent.toString() === parentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found in classroom' });
    }

    // Get all marks for the student
    const marks = await Marks.find({ 
      classCode, 
      studentId: student._id 
    })
    .sort({ date: -1 });

    res.json(marks);
  } catch (error) {
    console.error('Error fetching marks:', error);
    res.status(500).json({ message: 'Server error while fetching marks' });
  }
});

// Add route for parents to get their child's feedback
router.get('/parent/feedback/:classCode', auth, async (req, res) => {
  try {
    const parentId = req.user.id;
    const { classCode } = req.params;

    // Find the classroom and verify parent's child is enrolled
    const classroom = await Classroom.findOne({
      classCode,
      'students.parent': parentId
    });

    if (!classroom) {
      return res.status(404).json({ message: 'Classroom not found or not enrolled' });
    }

    // Get the student ID from the classroom
    const student = classroom.students.find(s => s.parent.toString() === parentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found in classroom' });
    }

    // Get all feedback for the student
    const feedback = await Feedback.find({ 
      classCode, 
      studentId: student._id 
    })
    .sort({ date: -1 });

    res.json(feedback);
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ message: 'Server error while fetching feedback' });
  }
});

// Add route to get student's overall progress
router.get('/parent/progress/:classCode', auth, async (req, res) => {
  try {
    const parentId = req.user.id;
    const { classCode } = req.params;

    // Find the classroom and verify parent's child is enrolled
    const classroom = await Classroom.findOne({
      classCode,
      'students.parent': parentId
    });

    if (!classroom) {
      return res.status(404).json({ message: 'Classroom not found or not enrolled' });
    }

    // Get the student ID from the classroom
    const student = classroom.students.find(s => s.parent.toString() === parentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found in classroom' });
    }

    // Get all marks, feedback, and activities for the student
    const [marks, feedback, activities] = await Promise.all([
      Marks.find({ classCode, studentId: student._id }).sort({ date: -1 }),
      Feedback.find({ classCode, studentId: student._id }).sort({ date: -1 }),
      Activity.find({ classCode }).sort({ date: -1 })
    ]);

    // Calculate overall progress
    const totalActivities = activities.length;
    const completedActivities = activities.filter(activity => 
      activity.completions.some(completion => 
        completion.parentId.toString() === parentId
      )
    ).length;

    // Calculate average marks
    const averageMarks = marks.length > 0
      ? marks.reduce((acc, mark) => acc + (mark.marks / mark.totalMarks * 100), 0) / marks.length
      : 0;

    res.json({
      student: {
        name: student.studentName,
        joinedAt: student.joinedAt
      },
      progress: {
        totalActivities,
        completedActivities,
        completionRate: totalActivities > 0 ? (completedActivities / totalActivities * 100) : 0,
        averageMarks: Math.round(averageMarks * 10) / 10,
        totalMarks: marks.length,
        totalFeedback: feedback.length
      },
      recentMarks: marks.slice(0, 5),
      recentFeedback: feedback.slice(0, 5)
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ message: 'Server error while fetching progress' });
  }
});

module.exports = router;
