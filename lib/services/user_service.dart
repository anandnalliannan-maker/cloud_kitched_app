import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class UserService {
  UserService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  Future<DocumentSnapshot<Map<String, dynamic>>> getCurrentUserDoc() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('User not signed in');
    }
    return _firestore.collection('users').doc(uid).get();
  }

  Future<void> ensureUserDoc({
    required String role,
    required bool approved,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw StateError('User not signed in');
    }

    final userRef = _firestore.collection('users').doc(user.uid);
    final snap = await userRef.get();

    if (!snap.exists) {
      await userRef.set({
        'role': role,
        'approved': approved,
        'active': true,
        'phone': user.phoneNumber,
        'createdAt': FieldValue.serverTimestamp(),
      });
    }
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> watchUsers() {
    return _firestore.collection('users').snapshots();
  }

  Future<void> setApproved(String uid, bool approved) {
    return _firestore.collection('users').doc(uid).update({
      'approved': approved,
    });
  }

  Future<void> setActive(String uid, bool active) {
    return _firestore.collection('users').doc(uid).update({
      'active': active,
    });
  }
}
